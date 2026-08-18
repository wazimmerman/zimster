import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import {
  COMPLETION_STATES,
  evaluateCandidateCompletion,
  evaluateHumanReleaseReview,
  evaluateRequirementMatrix,
  semanticContractDigest
} from './lib/semantic-assurance.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { evidenceStalenessReason } from './lib/evidence-validity.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

async function jsonFile(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  return JSON.parse(await readFile(file, 'utf8'));
}

async function jsonDocument(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  const data = await readFile(file);
  return {
    file,
    sha256: createHash('sha256').update(data).digest('hex'),
    value: JSON.parse(data.toString('utf8'))
  };
}

async function evidenceRecords(checkout) {
  const runtime = options.evidence
    ? null
    : await ensureRuntimeDirectory(root);
  const file = options.evidence
    ? path.resolve(process.cwd(), String(options.evidence))
    : path.join(runtime, 'evidence', 'receipts.jsonl');
  let rows;
  try {
    rows = (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const invalidated = new Set(
    rows
      .filter((row) => row.record_type === 'invalidation')
      .map((row) => row.receipt_id)
  );
  const records = [];
  for (const row of rows.filter((item) => item.record_type !== 'invalidation')) {
    const staleReason = invalidated.has(row.id)
      ? 'explicitly invalidated'
      : row.exit_code === 0
        ? await evidenceStalenessReason(row, { root, state: checkout })
        : null;
    records.push({
      ...row,
      status: invalidated.has(row.id) || staleReason
        ? 'stale'
        : row.exit_code === 0 ? 'valid' : 'failed',
      ...(staleReason ? { staleness_reason: staleReason } : {})
    });
  }
  return records;
}

async function evaluatedMatrix() {
  const requirements = await jsonFile('requirements');
  const matrixDocument = await jsonDocument('matrix');
  const checkout = await captureGitState(root);
  return {
    matrix: matrixDocument.value,
    matrixSha256: matrixDocument.sha256,
    semanticContractSha256: semanticContractDigest({
      bindingRequirements: requirements.requirements,
      matrix: matrixDocument.value
    }),
    checkout,
    result: evaluateRequirementMatrix({
      bindingRequirements: requirements.requirements,
      matrix: matrixDocument.value,
      evidence: await evidenceRecords(checkout)
    })
  };
}

async function matrixDecision() {
  const { result } = await evaluatedMatrix();
  writeLine(JSON.stringify(result));
  const counts = Object.entries(result.counts)
    .map(([state, count]) => `${state}=${count}`)
    .join(' ');
  writeError(`${result.valid ? 'MATRIX_VALID' : 'MATRIX_INCOMPLETE'} ${counts}`);
  for (const issue of result.issues) writeError(`- ${issue}`);
  if (!result.valid) process.exitCode = 2;
}

async function completionDecision() {
  const {
    matrix,
    semanticContractSha256,
    checkout,
    result: evaluatedResult
  } = await evaluatedMatrix();
  const checkoutIssues = [];
  if (matrix.candidate_head !== checkout.head) {
    checkoutIssues.push(
      `requirement matrix candidate head ${matrix.candidate_head} differs from current candidate head ${checkout.head}`
    );
  }
  if (matrix.candidate_tree !== checkout.tree) {
    checkoutIssues.push(
      `requirement matrix candidate tree ${matrix.candidate_tree} differs from current candidate tree ${checkout.tree}`
    );
  }
  if (
    checkout.dirty_tree_fingerprint
    !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  ) {
    checkoutIssues.push('current candidate checkout is dirty');
  }
  const matrixResult = checkoutIssues.length
    ? {
        ...evaluatedResult,
        valid: false,
        allowed_claims: [],
        issues: [...evaluatedResult.issues, ...checkoutIssues]
      }
    : evaluatedResult;
  const reviewFile = options.reviews ? await jsonFile('reviews') : { reviews: [] };
  const canonicalRuntime = await ensureRuntimeDirectory(root);
  let reviewLifecycle = null;
  let ownerRecordedDispatches = [];
  try {
    reviewLifecycle = JSON.parse(await readFile(
      path.join(canonicalRuntime, 'reviews', 'lifecycle.json'),
      'utf8'
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    ownerRecordedDispatches = (await readFile(
      path.join(canonicalRuntime, 'dispatches', 'dispatches.jsonl'),
      'utf8'
    )).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let hostSmokeReceipt = null;
  try {
    hostSmokeReceipt = options['host-smoke-receipt']
      ? await jsonFile('host-smoke-receipt')
      : JSON.parse(await readFile(path.join(await ensureRuntimeDirectory(root), 'host-smoke', 'latest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const profile = required(options, 'profile');
  const reviewPackage = profile === 'micro'
    ? null
    : await jsonFile('review-package');
  const packageIssues = [];
  if (reviewPackage) {
    if (reviewPackage.head !== matrix.candidate_head) {
      packageIssues.push('review package head differs from the requirement matrix candidate');
    }
    if (reviewPackage.semantic_contract?.sha256 !== semanticContractSha256) {
      packageIssues.push('review package semantic contract differs from the current contract');
    }
  }
  const finalMatrixResult = packageIssues.length
    ? {
        ...matrixResult,
        valid: false,
        allowed_claims: [],
        issues: [...matrixResult.issues, ...packageIssues]
      }
    : matrixResult;
  const result = evaluateCandidateCompletion({
    profile,
    microEligibility: options['micro-eligibility']
      ? await jsonFile('micro-eligibility')
      : null,
    ownerVerified: options['owner-verified'] === true,
    reviewUnavailable: options['review-unavailable'] === true,
    matrixResult: finalMatrixResult,
    reviews: reviewFile.reviews || [],
    reviewLifecycle,
    reviewerProvenance: ownerRecordedDispatches,
    candidateBase: reviewPackage?.base,
    candidateHead: matrix.candidate_head,
    candidateTree: matrix.candidate_tree,
    reviewPackageId: reviewPackage?.id,
    semanticContractSha256,
    requiredLenses: reviewPackage?.lenses || [],
    loadBearingReviewObligations: options['load-bearing-review-obligations']
      ? await jsonFile('load-bearing-review-obligations')
      : null,
    hostSmokeReceipt,
    releaseChannel: options['release-channel'] ? String(options['release-channel']) : 'public_beta',
    correctionPending: options['correction-pending'] === true
  });
  writeLine(JSON.stringify(result));
  writeError(`${result.state} review=${result.review_id || 'none'} claims=${result.allowed_claims.length}`);
  for (const reason of result.reasons) writeError(`- ${reason}`);
  if (result.state !== COMPLETION_STATES.CANDIDATE_COMPLETE) process.exitCode = 2;
}

async function humanReleaseReviewDecision() {
  const {
    matrix,
    matrixSha256,
    semanticContractSha256,
    checkout,
    result: matrixResult
  } = await evaluatedMatrix();
  const reviewPackage = await jsonFile('review-package');
  const reviewFile = await jsonFile('reviews');
  const review = (reviewFile.reviews || [])
    .filter(({ review_type: type }) => type === 'independent_review')
    .at(-1);
  const reasons = [];
  if (!matrixResult.valid) reasons.push(...matrixResult.issues, ...matrixResult.unverified_obligations);
  if (matrix.candidate_head !== checkout.head) reasons.push('requirement matrix candidate head differs from the current candidate head');
  if (matrix.candidate_tree !== checkout.tree) reasons.push('requirement matrix candidate tree differs from the current candidate tree');
  if (checkout.dirty_tree_fingerprint !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
    reasons.push('current candidate checkout is dirty');
  }
  if (reviewPackage.head !== matrix.candidate_head) reasons.push('review package head differs from the requirement matrix candidate');
  if (reviewPackage.requirement_matrix?.sha256 !== matrixSha256) reasons.push('review package requirement matrix digest differs from the current matrix');
  if (reviewPackage.semantic_contract?.sha256 !== semanticContractSha256) reasons.push('review package semantic contract differs from the current contract');
  const result = reasons.length ? {
    accepted: false,
    state: 'HUMAN_RELEASE_REVIEW_REJECTED',
    review_id: review?.id || null,
    reviewer_provenance: review?.reviewer_provenance || 'unavailable',
    runtime_assurance_state: COMPLETION_STATES.OWNER_VERIFIED_REVIEW_UNAVAILABLE,
    reasons: [...new Set(reasons)]
  } : evaluateHumanReleaseReview({
    review,
    authorization: {
      state: 'HUMAN_RELEASE_REVIEW_ACCEPTED',
      review_id: review?.id,
      reviewer_provenance: review?.reviewer_provenance,
      candidate_base: reviewPackage.base,
      candidate_head: matrix.candidate_head,
      candidate_tree: matrix.candidate_tree,
      review_package_id: reviewPackage.id,
      requirement_matrix_sha256: matrixSha256,
      semantic_contract_sha256: semanticContractSha256,
      required_lenses: reviewPackage.lenses || []
    },
    candidateHead: checkout.head,
    candidateTree: checkout.tree
  });
  writeLine(JSON.stringify(result));
  writeError(`${result.state} review=${result.review_id || 'none'} provenance=${result.reviewer_provenance}`);
  for (const reason of result.reasons) writeError(`- ${reason}`);
  if (!result.accepted) process.exitCode = 2;
}

if (action === 'matrix') {
  await matrixDecision();
} else if (action === 'complete') {
  await completionDecision();
} else if (action === 'release-review') {
  await humanReleaseReviewDecision();
} else {
  throw new Error('Usage: semantic-assurance.mjs <matrix|complete|release-review> --requirements <file> --matrix <file> [--evidence <jsonl>] [--reviews <json>] [--review-package <json>]');
}
