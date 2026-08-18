const TERMINAL = new Set([
  'CIRCUIT_BREAKER',
  'STRATEGY_ESCALATION_REQUIRES_OWNER',
  'REVIEW_LIFECYCLE_COMPLETE'
]);

function requiredId(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
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
    schema_version: 1,
    run_id: requiredId(runId, 'runId'),
    seam_id: requiredId(seamId, 'seamId'),
    status: 'INITIAL_REVIEW_REQUIRED',
    candidate: {
      revision: 0,
      digest: requiredId(candidateDigest, 'candidateDigest')
    },
    reviewer_id: null,
    aggregate: {
      initial_reviews: 0,
      correction_waves: 0,
      correction_rechecks: 0,
      final_integration_reviews: 0
    },
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
    if (state.status !== 'CORRECTION_RECHECK_REQUIRED') {
      throw new Error(`correction recheck is not allowed from ${state.status}`);
    }
    if (event.reviewerId !== state.reviewer_id) {
      throw new Error(`correction recheck must use the same reviewer ${state.reviewer_id}`);
    }
    if (!['approved', 'load_bearing_findings'].includes(event.verdict)) {
      throw new Error('correction recheck verdict must be approved or load_bearing_findings');
    }
    if (state.aggregate.correction_rechecks >= 1) {
      state.status = 'CIRCUIT_BREAKER';
      return record(state, event);
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
    if (!/^[0-9a-f]{40}$/.test(event.candidateHead || '')) {
      throw new Error('final integration review requires an exact candidate head');
    }
    if (!['approved', 'load_bearing_findings'].includes(event.verdict)) {
      throw new Error('final integration verdict must be approved or load_bearing_findings');
    }
    state.aggregate.final_integration_reviews += 1;
    state.final_candidate_head = event.candidateHead;
    state.status = event.verdict === 'approved'
      ? 'REVIEW_LIFECYCLE_COMPLETE'
      : 'CIRCUIT_BREAKER';
    return record(state, event);
  }

  throw new Error(`unsupported review lifecycle event: ${event.type}`);
}
