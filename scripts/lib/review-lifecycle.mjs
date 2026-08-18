import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const convergenceLimits = JSON.parse(readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'convergence.json'
), 'utf8')).autonomous_convergence.limits;

const TERMINAL = new Set([
  'CIRCUIT_BREAKER',
  'STRATEGY_ESCALATION_REQUIRES_OWNER',
  'REVIEW_LIFECYCLE_COMPLETE'
]);

function requiredId(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function immutableSha(value, name, length = 40) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value || '')) {
    throw new Error(`${name} must be an immutable ${length}-character SHA`);
  }
  return value;
}

function finalReviewBinding(state, event) {
  return {
    attempt_id: `${state.seam_id}:final:${state.aggregate.final_integration_reviews + 1}`,
    seam_id: state.seam_id,
    review_record_id: requiredId(event.reviewRecordId, 'reviewRecordId'),
    reviewer_id: requiredId(event.reviewerId, 'reviewerId'),
    dispatch_record_id: requiredId(event.dispatchRecordId, 'dispatchRecordId'),
    review_package_id: requiredId(event.reviewPackageId, 'reviewPackageId'),
    candidate_head: immutableSha(event.candidateHead, 'candidateHead'),
    candidate_tree: immutableSha(event.candidateTree, 'candidateTree'),
    semantic_contract_sha256: immutableSha(
      event.semanticContractSha256,
      'semanticContractSha256',
      64
    ),
    verdict: event.verdict
  };
}

function record(state, event) {
  state.history.push({
    sequence: state.history.length + 1,
    type: event.type,
    status: state.status,
    candidate_revision: state.candidate.revision
  });
  return state;
}

export function createReviewLifecycle({ runId, seamId, candidateDigest }) {
  return {
    schema_version: 2,
    run_id: requiredId(runId, 'runId'),
    seam_id: requiredId(seamId, 'seamId'),
    status: 'INITIAL_REVIEW_REQUIRED',
    candidate: {
      revision: 0,
      digest: requiredId(candidateDigest, 'candidateDigest')
    },
    reviewer_id: null,
    limits: {
      correction_rechecks: convergenceLimits.correction_rechecks,
      final_integration_reviews: convergenceLimits.final_integration_reviews,
      final_correction_waves: 1
    },
    aggregate: {
      initial_reviews: 0,
      correction_waves: 0,
      correction_rechecks: 0,
      final_integration_reviews: 0,
      final_correction_waves: 0
    },
    approved_review: null,
    history: []
  };
}

export function applyReviewLifecycleEvent(input, event) {
  const state = structuredClone(input);
  if (!event || typeof event.type !== 'string') throw new Error('review lifecycle event type is required');

  if (event.type === 'DESIGN_REVISION') {
    state.candidate = {
      revision: state.candidate.revision + 1,
      digest: requiredId(event.candidateDigest, 'candidateDigest')
    };
    if (state.aggregate.initial_reviews > 0) {
      state.status = 'STRATEGY_ESCALATION_REQUIRES_OWNER';
    }
    return record(state, event);
  }

  if (TERMINAL.has(state.status)) return state;

  if (event.type === 'INITIAL_REVIEW') {
    if (state.status !== 'INITIAL_REVIEW_REQUIRED') {
      throw new Error(`initial review is not allowed from ${state.status}`);
    }
    if (!['approved', 'needs_correction'].includes(event.verdict)) {
      throw new Error('initial review verdict must be approved or needs_correction');
    }
    state.reviewer_id = requiredId(event.reviewerId, 'reviewerId');
    state.aggregate.initial_reviews += 1;
    state.status = event.verdict === 'approved'
      ? 'FINAL_INTEGRATION_REVIEW_REQUIRED'
      : 'OWNER_CORRECTION_REQUIRED';
    return record(state, event);
  }

  if (event.type === 'OWNER_CORRECTION') {
    if (state.status !== 'OWNER_CORRECTION_REQUIRED') {
      throw new Error(`owner correction is not allowed from ${state.status}`);
    }
    if (state.aggregate.correction_waves >= 1) {
      state.status = 'CIRCUIT_BREAKER';
      return record(state, event);
    }
    state.aggregate.correction_waves += 1;
    state.status = 'CORRECTION_RECHECK_REQUIRED';
    return record(state, event);
  }

  if (event.type === 'CORRECTION_RECHECK') {
    if (state.aggregate.correction_rechecks >= state.limits.correction_rechecks) {
      state.status = 'CIRCUIT_BREAKER';
      return record(state, event);
    }
    if (state.status !== 'CORRECTION_RECHECK_REQUIRED') {
      throw new Error(`correction recheck is not allowed from ${state.status}`);
    }
    if (event.reviewerId !== state.reviewer_id) {
      throw new Error(`correction recheck must use the same reviewer ${state.reviewer_id}`);
    }
    if (!['approved', 'load_bearing_findings'].includes(event.verdict)) {
      throw new Error('correction recheck verdict must be approved or load_bearing_findings');
    }
    state.aggregate.correction_rechecks += 1;
    state.status = event.verdict === 'approved'
      ? 'FINAL_INTEGRATION_REVIEW_REQUIRED'
      : 'CIRCUIT_BREAKER';
    return record(state, event);
  }

  if (event.type === 'FINAL_INTEGRATION_REVIEW') {
    if (state.status !== 'FINAL_INTEGRATION_REVIEW_REQUIRED') {
      throw new Error(`final integration review is not allowed from ${state.status}`);
    }
    if (!['approved', 'load_bearing_findings'].includes(event.verdict)) {
      throw new Error('final integration verdict must be approved or load_bearing_findings');
    }
    if (state.aggregate.final_integration_reviews >= state.limits.final_integration_reviews) {
      state.status = 'STRATEGY_ESCALATION_REQUIRES_OWNER';
      return record(state, event);
    }
    const binding = finalReviewBinding(state, event);
    state.aggregate.final_integration_reviews += 1;
    state.final_candidate_head = binding.candidate_head;
    state.last_final_review = binding;
    if (event.verdict === 'approved') {
      state.approved_review = binding;
      state.status = 'REVIEW_LIFECYCLE_COMPLETE';
    } else {
      state.status = state.aggregate.final_integration_reviews < state.limits.final_integration_reviews
        ? 'FINAL_OWNER_CORRECTION_REQUIRED'
        : 'STRATEGY_ESCALATION_REQUIRES_OWNER';
    }
    return record(state, event);
  }

  if (event.type === 'FINAL_OWNER_CORRECTION') {
    if (state.status !== 'FINAL_OWNER_CORRECTION_REQUIRED') {
      throw new Error(`final owner correction is not allowed from ${state.status}`);
    }
    if (state.aggregate.final_correction_waves >= state.limits.final_correction_waves) {
      state.status = 'STRATEGY_ESCALATION_REQUIRES_OWNER';
      return record(state, event);
    }
    state.aggregate.final_correction_waves += 1;
    state.candidate = {
      revision: state.candidate.revision + 1,
      digest: requiredId(event.candidateDigest, 'candidateDigest')
    };
    state.status = 'FINAL_INTEGRATION_REVIEW_REQUIRED';
    return record(state, event);
  }

  throw new Error(`unsupported review lifecycle event: ${event.type}`);
}
