const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const REVIEW_ATTEMPT_TYPES = Object.freeze([
  'initial_review',
  'correction_recheck',
  'new_design_review',
  'final_integration_review'
]);

export const BREAKER_DISPOSITIONS = Object.freeze([
  'reviewer_rebutted_with_evidence',
  'blocked_by_requirement',
  'non_load_bearing_deferral',
  'design_revision',
  'partial_or_blocked'
]);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function validateCandidate(value, label = 'candidate') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const field of ['base_sha', 'head_sha', 'tree_sha']) {
    if (!SHA_PATTERN.test(value[field] || '')) {
      throw new Error(`${label}.${field} must be an immutable 40-character SHA`);
    }
  }
  for (const field of ['dirty_tree_fingerprint', 'semantic_contract_sha256']) {
    if (!SHA256_PATTERN.test(value[field] || '')) {
      throw new Error(`${label}.${field} must be a SHA-256 digest`);
    }
  }
  return value;
}

function sameCandidate(left, right) {
  return ['base_sha', 'head_sha', 'tree_sha', 'dirty_tree_fingerprint', 'semantic_contract_sha256']
    .every((field) => left[field] === right[field]);
}

function loadBearing(findings) {
  return findings.some(({ severity }) => severity === 'Critical' || severity === 'Important');
}

function copy(state) {
  return structuredClone(state);
}

function appendEvent(state, event) {
  state.events.push(structuredClone(event));
  return state;
}

export function createReviewLifecycle({ seam_id, reviewer_identity, candidate }) {
  return {
    schema_version: 1,
    seam_id: requireString(seam_id, 'seam_id'),
    reviewer_identity: requireString(reviewer_identity, 'reviewer_identity'),
    initial_candidate: structuredClone(validateCandidate(candidate)),
    candidate: structuredClone(validateCandidate(candidate)),
    status: 'initial_review_required',
    stable: false,
    circuit_breaker_active: false,
    correction_recheck_consumed: false,
    active_attempt_id: null,
    attempts: [],
    invalidated_attempt_ids: [],
    dispositions: [],
    events: []
  };
}

function validateAttempt(attempt, state) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
    throw new Error('attempt must be an object');
  }
  if (!REVIEW_ATTEMPT_TYPES.includes(attempt.attempt_type)) {
    throw new Error(`unsupported review attempt type: ${attempt.attempt_type}`);
  }
  for (const field of ['attempt_id', 'seam_id', 'reviewer_identity', 'review_package_id']) {
    requireString(attempt[field], `attempt.${field}`);
  }
  validateCandidate(attempt.candidate, 'attempt.candidate');
  if (attempt.seam_id !== state.seam_id) throw new Error('review attempt belongs to a different seam');
  if (attempt.reviewer_identity !== state.reviewer_identity) {
    throw new Error('replacement reviewer is forbidden for an unchanged candidate lifecycle');
  }
  if (state.attempts.some(({ attempt_id }) => attempt_id === attempt.attempt_id)) {
    throw new Error(`review attempt ID is already consumed: ${attempt.attempt_id}`);
  }
}

function startAttempt(state, attempt) {
  validateAttempt(attempt, state);
  if (state.circuit_breaker_active) {
    throw new Error('circuit breaker is active; record a supported disposition before another review');
  }
  if (state.active_attempt_id) throw new Error('a review attempt is already active');

  const expected = {
    initial_review_required: 'initial_review',
    correction_recheck_required: 'correction_recheck',
    new_design_review_required: 'new_design_review'
  }[state.status];
  if (expected && attempt.attempt_type !== expected) {
    throw new Error(`${state.status} requires ${expected}`);
  }
  if (!expected) {
    if (attempt.attempt_type !== 'final_integration_review' || state.status !== 'approved') {
      throw new Error(`review attempt ${attempt.attempt_type} is not allowed while lifecycle is ${state.status}`);
    }
    if (!state.stable) throw new Error('final integration review requires a stable candidate');
  }
  if (attempt.attempt_type === 'correction_recheck' && state.correction_recheck_consumed) {
    throw new Error('correction recheck is already consumed for this seam');
  }
  if (!sameCandidate(attempt.candidate, state.candidate)) {
    throw new Error('review attempt does not bind the exact current semantic candidate');
  }

  const next = copy(state);
  next.attempts.push({ ...structuredClone(attempt), verdict: null, findings: [] });
  next.active_attempt_id = attempt.attempt_id;
  next.status = attempt.attempt_type === 'final_integration_review'
    ? 'final_review_in_progress'
    : 'review_in_progress';
  if (attempt.attempt_type === 'correction_recheck') next.correction_recheck_consumed = true;
  return appendEvent(next, {
    type: 'attempt_started',
    attempt: structuredClone(attempt)
  });
}

function recordVerdict(state, event) {
  if (event.attempt_id !== state.active_attempt_id) {
    throw new Error('verdict must bind the active review attempt ID');
  }
  if (!['approved', 'needs_correction'].includes(event.verdict)) {
    throw new Error('review verdict must be approved or needs_correction');
  }
  if (!Array.isArray(event.findings || [])) throw new Error('review findings must be an array');
  if (event.verdict === 'approved' && loadBearing(event.findings || [])) {
    throw new Error('approved verdict cannot carry Critical or Important load-bearing findings');
  }
  const next = copy(state);
  const attempt = next.attempts.find(({ attempt_id }) => attempt_id === event.attempt_id);
  attempt.verdict = event.verdict;
  attempt.findings = structuredClone(event.findings || []);
  next.active_attempt_id = null;
  if (event.verdict === 'approved') {
    next.status = attempt.attempt_type === 'final_integration_review' ? 'final_approved' : 'approved';
  } else {
    if (!loadBearing(attempt.findings)) {
      throw new Error('needs_correction requires a Critical or Important load-bearing finding');
    }
    if (attempt.attempt_type === 'final_integration_review') {
      next.status = 'final_correction_required';
      next.stable = false;
    } else if (attempt.attempt_type === 'correction_recheck') {
      next.status = 'circuit_breaker_active';
      next.circuit_breaker_active = true;
    } else {
      next.status = 'correction_required';
    }
  }
  return appendEvent(next, {
    type: 'verdict_recorded',
    attempt_id: event.attempt_id,
    verdict: event.verdict,
    findings: structuredClone(event.findings || [])
  });
}

function recordCorrection(state, event) {
  if (!['correction_required', 'final_correction_required'].includes(state.status)) {
    throw new Error('owner correction is allowed only after a needs_correction verdict');
  }
  validateCandidate(event.candidate);
  if (event.candidate.semantic_contract_sha256 !== state.candidate.semantic_contract_sha256) {
    throw new Error('a changed semantic candidate requires an explicit design revision disposition');
  }
  if (sameCandidate(event.candidate, state.candidate)) {
    throw new Error('owner correction must change the exact candidate identity');
  }
  const next = copy(state);
  const finalCorrection = state.status === 'final_correction_required';
  next.candidate = structuredClone(event.candidate);
  next.stable = false;
  next.status = finalCorrection ? 'approved' : 'correction_recheck_required';
  return appendEvent(next, { type: 'correction_recorded', candidate: event.candidate });
}

function recordDisposition(state, event) {
  const finalDesignRevision = event.disposition === 'design_revision'
    && state.status === 'final_correction_required'
    && state.circuit_breaker_active === false;
  if ((!state.circuit_breaker_active || state.status !== 'circuit_breaker_active')
    && !finalDesignRevision) {
    throw new Error('breaker disposition requires an active circuit breaker');
  }
  if (!BREAKER_DISPOSITIONS.includes(event.disposition)) {
    throw new Error(`unsupported breaker disposition: ${event.disposition}`);
  }
  requireString(event.reason, 'breaker disposition reason');
  if (!Array.isArray(event.evidence_refs) || !event.evidence_refs.length) {
    throw new Error('breaker disposition requires evidence_refs');
  }
  const next = copy(state);
  const disposition = {
    disposition: event.disposition,
    reason: event.reason,
    evidence_refs: [...event.evidence_refs]
  };
  if (event.disposition === 'design_revision') {
    validateCandidate(event.candidate, 'design revision candidate');
    if (event.candidate.semantic_contract_sha256 === state.candidate.semantic_contract_sha256) {
      throw new Error('semantic candidate contract must change for a design revision');
    }
    disposition.prior_semantic_contract_sha256 = state.candidate.semantic_contract_sha256;
    disposition.new_semantic_contract_sha256 = event.candidate.semantic_contract_sha256;
    next.invalidated_attempt_ids.push(...next.attempts
      .filter(({ attempt_id }) => !next.invalidated_attempt_ids.includes(attempt_id))
      .map(({ attempt_id }) => attempt_id));
    next.candidate = structuredClone(event.candidate);
    next.correction_recheck_consumed = false;
    next.stable = false;
    next.status = 'new_design_review_required';
  } else if (event.disposition === 'reviewer_rebutted_with_evidence'
    || event.disposition === 'non_load_bearing_deferral') {
    next.status = 'approved';
  } else if (event.disposition === 'blocked_by_requirement') {
    next.status = 'blocked';
  } else {
    next.status = 'partial';
  }
  next.circuit_breaker_active = false;
  next.dispositions.push(disposition);
  return appendEvent(next, {
    type: 'breaker_disposition_recorded',
    ...disposition,
    ...(event.disposition === 'design_revision'
      ? { candidate: structuredClone(event.candidate) }
      : {})
  });
}

function replayLifecycle(state) {
  let replayed = createReviewLifecycle({
    seam_id: state.seam_id,
    reviewer_identity: state.reviewer_identity,
    candidate: state.initial_candidate
  });
  for (const event of state.events) {
    if (event.type === 'attempt_started') replayed = startAttempt(replayed, event.attempt);
    else if (event.type === 'verdict_recorded') replayed = recordVerdict(replayed, event);
    else if (event.type === 'correction_recorded') replayed = recordCorrection(replayed, event);
    else if (event.type === 'breaker_disposition_recorded') {
      replayed = recordDisposition(replayed, event);
    } else if (event.type === 'candidate_stabilized') {
      if (replayed.status !== 'approved' || replayed.circuit_breaker_active) {
        throw new Error('review lifecycle event history stabilizes an unapproved candidate');
      }
      const next = copy(replayed);
      next.stable = true;
      replayed = appendEvent(next, { type: 'candidate_stabilized' });
    } else {
      throw new Error(`review lifecycle contains unsupported event: ${event.type}`);
    }
  }
  return replayed;
}

export function applyReviewLifecycleEvent(state, event) {
  validateReviewLifecycle(state);
  if (!event || typeof event !== 'object') throw new Error('review lifecycle event is required');
  if (event.type === 'attempt_started') return startAttempt(state, event.attempt);
  if (event.type === 'verdict_recorded') return recordVerdict(state, event);
  if (event.type === 'correction_recorded') return recordCorrection(state, event);
  if (event.type === 'breaker_disposition_recorded') return recordDisposition(state, event);
  if (event.type === 'candidate_stabilized') {
    if (state.status !== 'approved' || state.circuit_breaker_active) {
      throw new Error('only an approved breaker-free candidate can be stabilized');
    }
    const next = copy(state);
    next.stable = true;
    return appendEvent(next, { type: 'candidate_stabilized' });
  }
  throw new Error(`unsupported review lifecycle event: ${event.type}`);
}

export function validateReviewLifecycle(state, {
  candidateHead = null,
  candidateTree = null,
  requireFinalApproval = false
} = {}) {
  if (!state || state.schema_version !== 1) throw new Error('review lifecycle must be schema v1');
  if (requireFinalApproval && state.circuit_breaker_active === true) {
    throw new Error('review lifecycle circuit breaker is active');
  }
  requireString(state.seam_id, 'review lifecycle seam_id');
  requireString(state.reviewer_identity, 'review lifecycle reviewer_identity');
  validateCandidate(state.initial_candidate, 'review lifecycle initial_candidate');
  validateCandidate(state.candidate, 'review lifecycle candidate');
  for (const field of ['attempts', 'invalidated_attempt_ids', 'dispositions', 'events']) {
    if (!Array.isArray(state[field])) throw new Error(`review lifecycle requires ${field}`);
  }
  if (typeof state.circuit_breaker_active !== 'boolean'
    || typeof state.correction_recheck_consumed !== 'boolean'
    || typeof state.stable !== 'boolean') {
    throw new Error('review lifecycle requires boolean breaker, recheck, and stable state');
  }
  const attemptIds = state.attempts.map(({ attempt_id }) => attempt_id);
  if (new Set(attemptIds).size !== attemptIds.length) throw new Error('review attempt IDs must be unique');
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id)
  );
  for (const attempt of state.attempts) {
    if (!REVIEW_ATTEMPT_TYPES.includes(attempt.attempt_type)) {
      throw new Error('review lifecycle contains an unsupported attempt type');
    }
    for (const field of ['attempt_id', 'seam_id', 'reviewer_identity', 'review_package_id']) {
      requireString(attempt[field], `review lifecycle attempt.${field}`);
    }
    if (attempt.seam_id !== state.seam_id || attempt.reviewer_identity !== state.reviewer_identity) {
      throw new Error('review lifecycle attempt seam or reviewer identity is inconsistent');
    }
    validateCandidate(attempt.candidate, 'review lifecycle attempt candidate');
    if (![null, 'approved', 'needs_correction'].includes(attempt.verdict)) {
      throw new Error('review lifecycle attempt has an unsupported verdict');
    }
    if (!Array.isArray(attempt.findings)) throw new Error('review lifecycle attempt requires findings');
  }
  if (activeAttempts.filter(({ attempt_type }) => attempt_type === 'correction_recheck').length > 1) {
    throw new Error('only one correction recheck is permitted per reviewed seam');
  }
  if (state.circuit_breaker_active !== (state.status === 'circuit_breaker_active')) {
    throw new Error('circuit breaker status is inconsistent');
  }
  if (candidateHead && state.candidate.head_sha !== candidateHead) {
    throw new Error('review lifecycle does not bind the candidate head');
  }
  if (candidateTree && state.candidate.tree_sha !== candidateTree) {
    throw new Error('review lifecycle does not bind the candidate tree');
  }
  if (requireFinalApproval && state.status !== 'final_approved') {
    throw new Error(state.circuit_breaker_active
      ? 'review lifecycle circuit breaker is active'
      : 'final integration review approval is missing');
  }
  if (state.status === 'final_approved') {
    const finalAttempt = activeAttempts.at(-1);
    if (!state.stable
      || finalAttempt?.attempt_type !== 'final_integration_review'
      || finalAttempt.verdict !== 'approved'
      || !sameCandidate(finalAttempt.candidate, state.candidate)) {
      throw new Error('final approval does not bind the stable current candidate and final attempt');
    }
  }
  let replayed;
  try {
    replayed = replayLifecycle(state);
  } catch (error) {
    throw new Error(`review lifecycle event integrity failed: ${error.message}`);
  }
  if (JSON.stringify(replayed) !== JSON.stringify(state)) {
    throw new Error('review lifecycle state is inconsistent with its durable event history');
  }
  return state;
}

function exactSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export function validateAssuranceAccounting(receipt, {
  candidateHead,
  candidateTree,
  recordedReviewAttemptIds = null,
  recordedReviewAttemptCounts = null,
  requiredReviewerIdentities = []
}) {
  if (!receipt || receipt.schema_version !== 1) {
    throw new Error('assurance accounting reconciliation must be schema v1');
  }
  if (receipt.candidate_head !== candidateHead || receipt.candidate_tree !== candidateTree) {
    throw new Error('assurance accounting does not bind the exact candidate');
  }
  for (const field of [
    'observed_agent_ids', 'dispatch_agent_ids', 'budget_agent_ids',
    'observed_review_attempt_ids', 'recorded_review_attempt_ids'
  ]) {
    if (!Array.isArray(receipt[field])) throw new Error(`assurance accounting requires ${field}`);
  }
  if (!exactSet(receipt.observed_agent_ids, receipt.dispatch_agent_ids)
    || !exactSet(receipt.observed_agent_ids, receipt.budget_agent_ids)) {
    throw new Error('observed agents must reconcile with dispatch and budget accounting');
  }
  if (!exactSet(receipt.observed_review_attempt_ids, receipt.recorded_review_attempt_ids)) {
    throw new Error('observed review attempts must reconcile with durable review accounting');
  }
  if (recordedReviewAttemptIds
    && !exactSet(receipt.recorded_review_attempt_ids, recordedReviewAttemptIds)) {
    throw new Error('assurance accounting review attempts differ from the review lifecycle attempts');
  }
  for (const field of ['recorded_review_attempt_counts', 'budget_review_attempt_counts']) {
    const counts = receipt[field];
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      throw new Error(`assurance accounting requires ${field}`);
    }
    for (const metric of ['correction_rechecks', 'final_integration_reviews']) {
      if (!Number.isInteger(counts[metric]) || counts[metric] < 0) {
        throw new Error(`assurance accounting requires a non-negative ${field}.${metric}`);
      }
    }
  }
  for (const metric of ['correction_rechecks', 'final_integration_reviews']) {
    if (receipt.recorded_review_attempt_counts[metric]
      !== receipt.budget_review_attempt_counts[metric]) {
      throw new Error(`${metric.replaceAll('_', ' ')} must reconcile with budget usage`);
    }
    if (recordedReviewAttemptCounts
      && receipt.recorded_review_attempt_counts[metric] !== recordedReviewAttemptCounts[metric]) {
      throw new Error(`${metric.replaceAll('_', ' ')} differs from review lifecycle accounting`);
    }
  }
  const observedAgents = new Set(receipt.observed_agent_ids);
  if (requiredReviewerIdentities.some((identity) => !observedAgents.has(identity))) {
    throw new Error('every lifecycle reviewer identity must be an observed accounted agent');
  }
  if (!Number.isInteger(receipt.observed_max_depth)
    || !Number.isInteger(receipt.allowed_max_depth)
    || receipt.allowed_max_depth !== 1
    || receipt.observed_max_depth > receipt.allowed_max_depth) {
    throw new Error('nested-agent depth exceeds the recorded allowed depth');
  }
  if (receipt.reconciliation_complete !== true) {
    throw new Error('assurance accounting reconciliation is incomplete');
  }
  return receipt;
}
