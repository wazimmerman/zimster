import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { captureGitState } from './git-state.mjs';

function sameCandidate(left, right) {
  return [
    ['base_sha', 'base'],
    ['head_sha', 'head'],
    ['tree_sha', 'tree'],
    ['dirty_tree_fingerprint', 'dirty_tree_fingerprint'],
    ['semantic_contract_sha256', 'semantic_contract_sha256']
  ].every(([candidateField, packageField]) =>
    left?.[candidateField] === right?.[packageField]);
}

async function jsonLines(file) {
  try {
    return (await readFile(file, 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function authenticateReviewerDisposition(runtime, state, disposition, {
  cwd = process.cwd()
} = {}) {
  const attempt = state.attempts.find(({ attempt_id }) =>
    attempt_id === disposition.attempt_id);
  if (!attempt || attempt.verdict !== 'needs_correction'
    || state.strategy_escalation?.attempt_id !== attempt.attempt_id
    || attempt.reviewer_identity !== disposition.reviewer_identity
    || attempt.review_package_id !== disposition.review_package_id) {
    throw new Error('reviewer disposition does not bind the exhausted authoritative attempt');
  }
  const packageFile = path.join(
    runtime, 'reviews', disposition.review_package_id, 'review-package.json'
  );
  let reviewPackage;
  try {
    reviewPackage = JSON.parse(await readFile(packageFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('reviewer disposition review package is unavailable');
    }
    throw error;
  }
  const packageCandidate = {
    base: reviewPackage.base,
    head: reviewPackage.head,
    tree: reviewPackage.candidate_checkout?.tree,
    dirty_tree_fingerprint: reviewPackage.candidate_checkout?.dirty_tree_fingerprint,
    semantic_contract_sha256: reviewPackage.semantic_contract?.sha256
  };
  if (reviewPackage.schema_version !== 2
    || reviewPackage.id !== disposition.review_package_id
    || reviewPackage.attempt_type !== attempt.attempt_type
    || reviewPackage.attempt_id !== disposition.attempt_id
    || reviewPackage.seam_id !== state.seam_id
    || !sameCandidate(disposition.candidate, packageCandidate)
    || !sameCandidate(state.candidate, packageCandidate)) {
    throw new Error('reviewer disposition does not bind the immutable final review package');
  }
  const dispatches = await jsonLines(path.join(runtime, 'dispatches', 'dispatches.jsonl'));
  const matchingDispatches = dispatches.filter(({ id }) => id === disposition.dispatch_id);
  const dispatch = matchingDispatches[0];
  const packageIdentity = `.git/zimster/reviews/${disposition.review_package_id}/review-package.json`;
  if (matchingDispatches.length !== 1
    || dispatch.schema_version !== 2
    || dispatch.role !== 'integration-reviewer'
    || dispatch.agent_id !== state.reviewer_identity
    || dispatch.owner_acceptance?.status !== 'accepted'
    || dispatch.owner_acceptance?.proof !== disposition.disposition_id
    || !dispatch.completed_at
    || dispatch.task_signature?.role !== 'integration-reviewer'
    || dispatch.task_signature?.risk !== 'high'
    || dispatch.task_signature?.proof_kind !== 'review-disposition'
    || !dispatch.task_signature?.traits?.includes('strategy-disposition')
    || !dispatch.dependency_cone?.some((identity) =>
      identity === packageIdentity || String(identity).endsWith(`/${packageIdentity}`))) {
    throw new Error('reviewer disposition lacks an accepted authoritative reviewer dispatch');
  }
  const observations = await jsonLines(path.join(runtime, 'routing', 'observations.jsonl'));
  const matchingObservations = observations.filter(({ id }) =>
    id === disposition.routing_observation_id);
  const observation = matchingObservations[0];
  if (matchingObservations.length !== 1
    || observation.dispatch_id !== dispatch.id
    || observation.role !== 'integration-reviewer'
    || observation.proof_kind !== 'review-disposition'
    || observation.owner_acceptance !== 'accepted'
    || !observation.evidence_references?.includes(disposition.disposition_id)) {
    throw new Error('reviewer disposition lacks its accepted routing observation');
  }
  const checkout = await captureGitState(cwd);
  if (checkout.head !== state.candidate.head_sha
    || checkout.tree !== state.candidate.tree_sha
    || checkout.dirty_tree_fingerprint !== state.candidate.dirty_tree_fingerprint) {
    throw new Error('reviewer disposition does not bind the current checkout');
  }
  return {
    disposition_id: disposition.disposition_id,
    dispatch_id: dispatch.id,
    routing_observation_id: observation.id,
    review_package_id: reviewPackage.id
  };
}

export async function authenticateFinalReviewAuthorization(runtime, state, options = {}) {
  if (state.status !== 'final_approved') return { type: 'not_final_approved' };
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id));
  const finalAttempt = activeAttempts.at(-1);
  if (finalAttempt?.verdict === 'approved') {
    return { type: 'review_verdict', attempt_id: finalAttempt.attempt_id };
  }
  const disposition = state.dispositions.at(-1);
  const reviewerDisposition = (state.reviewer_dispositions || [])
    .find(({ disposition_id }) =>
      disposition_id === disposition?.reviewer_disposition_id);
  if (!reviewerDisposition) {
    throw new Error('final approval lacks an authoritative reviewer disposition');
  }
  await authenticateReviewerDisposition(runtime, state, reviewerDisposition, options);
  return {
    type: 'reviewer_disposition',
    disposition_id: reviewerDisposition.disposition_id,
    attempt_id: reviewerDisposition.attempt_id
  };
}
