import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const convergenceConfig = JSON.parse(readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'convergence.json'
), 'utf8'));
const lifecycleLimits = convergenceConfig.review_lifecycle;

const TERMINAL = new Set([
  'CIRCUIT_BREAKER',
  'STRATEGY_ESCALATION_REQUIRES_OWNER',
  'BLOCKED',
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
    candidate_revision: state.candidate.revision,
    candidate_digest: state.candidate.digest,
    review_cycle: state.current_cycle,
    reviewer_id: state.reviewer_id
  });
  return state;
}

function ensureLifecycleShape(state) {
  state.current_cycle ??= 1;
  state.limits.correction_rechecks_per_cycle ??=
    state.limits.correction_rechecks ?? lifecycleLimits.correction_rechecks_per_cycle;
  state.limits.review_cycles_per_seam ??=
    state.limits.review_cycles ?? lifecycleLimits.review_cycles_per_seam;
  state.limits.strategy_restarts_per_seam ??=
    state.limits.strategy_restarts ?? lifecycleLimits.strategy_restarts_per_seam;
  state.limits.final_integration_reviews ??= lifecycleLimits.final_integration_reviews;
  state.limits.final_correction_waves ??= lifecycleLimits.final_correction_waves;
  state.aggregate.review_cycles ??= 1;
  state.aggregate.strategy_restarts ??= 0;
  state.strategy_revisions ??= [];
  state.review_cycles ??= [{
    number: 1,
    candidate_digest: state.candidate.digest,
    reviewer_id: state.reviewer_id,
    initial_reviews: state.aggregate.initial_reviews,
    correction_waves: state.aggregate.correction_waves,
    correction_rechecks: state.aggregate.correction_rechecks,
    status: state.status === 'CIRCUIT_BREAKER' ? 'exhausted' : 'active'
  }];
  return state;
}

function currentReviewCycle(state) {
  return state.review_cycles.find(({ number }) => number === state.current_cycle);
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
      correction_rechecks_per_cycle: lifecycleLimits.correction_rechecks_per_cycle,
      review_cycles_per_seam: lifecycleLimits.review_cycles_per_seam,
      strategy_restarts_per_seam: lifecycleLimits.strategy_restarts_per_seam,
      final_integration_reviews: lifecycleLimits.final_integration_reviews,
      final_correction_waves: lifecycleLimits.final_correction_waves
    },
    aggregate: {
      review_cycles: 1,
      initial_reviews: 0,
      correction_waves: 0,
      correction_rechecks: 0,
      final_integration_reviews: 0,
      final_correction_waves: 0,
      strategy_restarts: 0
    },
    current_cycle: 1,
    review_cycles: [{
      number: 1,
      candidate_digest: requiredId(candidateDigest, 'candidateDigest'),
      reviewer_id: null,
      initial_reviews: 0,
      correction_waves: 0,
      correction_rechecks: 0,
      status: 'active'
    }],
    strategy_revisions: [],
    approved_review: null,
    history: []
  };
}

export function applyReviewLifecycleEvent(input, event) {
  const state = ensureLifecycleShape(structuredClone(input));
  if (!event || typeof event.type !== 'string') throw new Error('review lifecycle event type is required');

  if (['BLOCKED', 'REVIEW_LIFECYCLE_COMPLETE'].includes(state.status)) return state;

  if (event.type === 'ENTER_STRATEGY_ESCALATION') {
    if (
      state.status !== 'CIRCUIT_BREAKER'
      || state.current_cycle !== 1
      || state.circuit_breaker_reason !== 'load_bearing_findings_after_recheck'
    ) {
      throw new Error('strategy escalation requires the exhausted first review cycle');
    }
    state.status = 'STRATEGY_ESCALATION_REQUIRES_OWNER';
    return record(state, event);
  }

  if (event.type === 'STRATEGY_REVISION_ACCEPTED') {
    if (state.status !== 'STRATEGY_ESCALATION_REQUIRES_OWNER') {
      throw new Error('strategy revision requires owner strategy escalation after an exhausted review cycle');
    }
    if (
      state.aggregate.strategy_restarts >= state.limits.strategy_restarts_per_seam
      || state.aggregate.review_cycles >= state.limits.review_cycles_per_seam
    ) {
      state.status = 'BLOCKED';
      return record(state, event);
    }
    const originatingCycle = currentReviewCycle(state);
    if (
      originatingCycle.status !== 'exhausted'
      || state.circuit_breaker_reason !== 'load_bearing_findings_after_recheck'
    ) {
      throw new Error('strategy revision requires a failed correction recheck in the exhausted cycle');
    }
    const previousCandidateDigest = requiredId(
      event.previousCandidateDigest,
      'previousCandidateDigest'
    );
    const replacementCandidateDigest = requiredId(event.candidateDigest, 'candidateDigest');
    if (previousCandidateDigest !== state.candidate.digest) {
      throw new Error('previous candidate identity does not match the exhausted review cycle');
    }
    if (replacementCandidateDigest === previousCandidateDigest) {
      throw new Error('replacement candidate identity must differ from the previous candidate');
    }
    if (event.materialChange !== true) {
      throw new Error('strategy revision must record a material strategy/design change');
    }
    if (event.focusedProofStatus !== 'passed') {
      throw new Error('strategy revision requires passed focused deterministic proof');
    }
    const strategyReason = requiredId(event.strategyReason, 'strategyReason');
    state.strategy_revisions.push({
      number: state.aggregate.strategy_restarts + 1,
      originating_cycle: originatingCycle.number,
      run_id: state.run_id,
      seam_id: state.seam_id,
      previous_candidate_digest: previousCandidateDigest,
      replacement_candidate_digest: replacementCandidateDigest,
      strategy_reason: strategyReason,
      material_change: true,
      focused_proof_status: 'passed'
    });
    state.aggregate.strategy_restarts += 1;
    state.aggregate.review_cycles += 1;
    state.current_cycle += 1;
    state.candidate = {
      revision: state.candidate.revision + 1,
      digest: replacementCandidateDigest
    };
    state.reviewer_id = null;
    delete state.circuit_breaker_reason;
    state.review_cycles.push({
      number: state.current_cycle,
      candidate_digest: replacementCandidateDigest,
      reviewer_id: null,
      initial_reviews: 0,
      correction_waves: 0,
      correction_rechecks: 0,
      status: 'active'
    });
    state.status = 'NEW_STRATEGY_REVIEW_REQUIRED';
    return record(state, event);
  }

  if (event.type === 'DESIGN_REVISION') {
    const cycle = currentReviewCycle(state);
    if (cycle.initial_reviews > 0) {
      throw new Error(
        'candidate digest change cannot bypass an exhausted review cycle; use explicit strategy admission'
      );
    }
    state.candidate = {
      revision: state.candidate.revision + 1,
      digest: requiredId(event.candidateDigest, 'candidateDigest')
    };
    cycle.candidate_digest = state.candidate.digest;
    return record(state, event);
  }

  if (TERMINAL.has(state.status)) return state;

  if (event.type === 'INITIAL_REVIEW') {
    if (!['INITIAL_REVIEW_REQUIRED', 'NEW_STRATEGY_REVIEW_REQUIRED'].includes(state.status)) {
      throw new Error(`initial review is not allowed from ${state.status}`);
    }
    if (!['approved', 'needs_correction'].includes(event.verdict)) {
      throw new Error('initial review verdict must be approved or needs_correction');
    }
    const cycle = currentReviewCycle(state);
    state.reviewer_id = requiredId(event.reviewerId, 'reviewerId');
    cycle.reviewer_id = state.reviewer_id;
    cycle.initial_reviews += 1;
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
    const cycle = currentReviewCycle(state);
    if (cycle.correction_waves >= 1) {
      state.status = 'CIRCUIT_BREAKER';
      state.circuit_breaker_reason = 'correction_wave_limit_exceeded';
      return record(state, event);
    }
    cycle.correction_waves += 1;
    state.aggregate.correction_waves += 1;
    state.status = 'CORRECTION_RECHECK_REQUIRED';
    return record(state, event);
  }

  if (event.type === 'CORRECTION_RECHECK') {
    const cycle = currentReviewCycle(state);
    if (cycle.correction_rechecks >= state.limits.correction_rechecks_per_cycle) {
      state.status = 'CIRCUIT_BREAKER';
      state.circuit_breaker_reason = 'correction_recheck_limit_exceeded';
      return record(state, event);
    }
    if (state.status !== 'CORRECTION_RECHECK_REQUIRED') {
      throw new Error(`correction recheck is not allowed from ${state.status}`);
    }
    if (event.reviewerId !== cycle.reviewer_id) {
      throw new Error(`correction recheck must use the same reviewer ${cycle.reviewer_id}`);
    }
    if (!['approved', 'load_bearing_findings'].includes(event.verdict)) {
      throw new Error('correction recheck verdict must be approved or load_bearing_findings');
    }
    cycle.correction_rechecks += 1;
    state.aggregate.correction_rechecks += 1;
    if (event.verdict === 'approved') {
      cycle.status = 'approved';
      state.status = 'FINAL_INTEGRATION_REVIEW_REQUIRED';
    } else {
      cycle.status = 'exhausted';
      if (state.current_cycle >= state.limits.review_cycles_per_seam) {
        state.status = 'BLOCKED';
        state.circuit_breaker_reason = 'second_review_cycle_exhausted';
      } else {
        state.status = 'CIRCUIT_BREAKER';
        state.circuit_breaker_reason = 'load_bearing_findings_after_recheck';
      }
    }
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
