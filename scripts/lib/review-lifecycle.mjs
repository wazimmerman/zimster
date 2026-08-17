import { createHash } from 'node:crypto';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const REVIEW_ATTEMPT_TYPES = Object.freeze([
  'initial_review',
  'correction_recheck',
  'new_design_review',
  'final_integration_review'
]);

export const BREAKER_DISPOSITIONS = Object.freeze([
  'blocked_by_requirement',
  'design_revision',
  'partial_or_blocked'
]);

const UNTRUSTED_APPROVAL_DISPOSITIONS = Object.freeze([
  'reviewer_rebutted_with_evidence',
  'non_load_bearing_deferral'
]);

export const HARD_REVIEW_LIMITS = Object.freeze({
  primary_reviews_per_semantic_contract: 1,
  correction_rechecks: 1,
  final_integration_reviews: 2
});

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

export function reviewFindingFingerprint(attemptId, finding) {
  requireString(attemptId, 'review finding attempt ID');
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new Error('review finding must be an object');
  }
  return createHash('sha256').update(JSON.stringify({
    attempt_id: attemptId,
    severity: requireString(finding.severity, 'review finding severity'),
    summary: requireString(finding.summary, 'review finding summary'),
    evidence: finding.evidence || null
  })).digest('hex');
}

function copy(state) {
  return structuredClone(state);
}

function appendEvent(state, event) {
  state.events.push(structuredClone(event));
  return state;
}

function createLegacyReviewLifecycle({ seam_id, reviewer_identity, candidate }) {
  const current = createReviewLifecycle({ seam_id, reviewer_identity, candidate });
  delete current.review_policy;
  delete current.strategy_escalation;
  delete current.historical_excess_attempt_ids;
  delete current.reviewer_dispositions;
  return current;
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
    review_policy: { ...HARD_REVIEW_LIMITS },
    strategy_escalation: null,
    historical_excess_attempt_ids: [],
    active_attempt_id: null,
    attempts: [],
    invalidated_attempt_ids: [],
    reviewer_dispositions: [],
    dispositions: [],
    events: []
  };
}

function recordReviewerDisposition(state, event) {
  void state;
  void event;
  throw new Error(
    'trusted reviewer-output attestation is unavailable; caller-authored reviewer dispositions cannot authorize review'
  );
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
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id)
  );
  if (attempt.attempt_type === 'final_integration_review'
    && state.review_policy
    && activeAttempts.filter(({ attempt_type }) =>
      attempt_type === 'final_integration_review'
    ).length >= state.review_policy.final_integration_reviews) {
    throw new Error('final integration review hard limit is exhausted; strategy escalation is required');
  }

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
      next.stable = false;
      const finalAttempts = next.attempts.filter(({ attempt_id, attempt_type }) =>
        attempt_type === 'final_integration_review'
        && !next.invalidated_attempt_ids.includes(attempt_id)
      ).length;
      if (next.review_policy
        && finalAttempts >= next.review_policy.final_integration_reviews) {
        next.status = 'strategy_escalation_required';
        next.strategy_escalation = {
          status: 'required',
          trigger: 'final_review_attempts_exhausted',
          attempt_id: event.attempt_id,
          observed_final_attempts: finalAttempts,
          hard_limit: next.review_policy.final_integration_reviews
        };
      } else {
        next.status = 'final_correction_required';
      }
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
  if (![
    'correction_required',
    'correction_recheck_required',
    'final_correction_required'
  ].includes(state.status)) {
    throw new Error('owner correction is allowed only after a needs_correction verdict and before its recheck');
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

function updateCandidateBeforeReview(state, event) {
  if (!['initial_review_required', 'new_design_review_required'].includes(state.status)
    || state.active_attempt_id) {
    throw new Error('candidate can be updated only before the required primary review starts');
  }
  validateCandidate(event.candidate);
  if (event.candidate.semantic_contract_sha256 !== state.candidate.semantic_contract_sha256) {
    throw new Error('a semantic contract change requires an explicit design revision');
  }
  if (event.candidate.base_sha !== state.candidate.base_sha) {
    throw new Error('the review candidate base is immutable within a semantic contract');
  }
  if (sameCandidate(event.candidate, state.candidate)) {
    throw new Error('pre-review candidate update must change exact candidate identity');
  }
  const next = copy(state);
  next.candidate = structuredClone(event.candidate);
  next.stable = false;
  return appendEvent(next, {
    type: 'candidate_updated_before_review',
    candidate: structuredClone(event.candidate)
  });
}

function updateApprovedCandidateBeforeFinalReview(state, event) {
  if (state.status !== 'approved' || state.active_attempt_id) {
    throw new Error('approved candidate can advance only before a final-review attempt is active');
  }
  validateCandidate(event.candidate);
  if (event.candidate.semantic_contract_sha256 !== state.candidate.semantic_contract_sha256) {
    throw new Error('a semantic contract change requires an explicit design revision');
  }
  if (event.candidate.base_sha !== state.candidate.base_sha) {
    throw new Error('the review candidate base is immutable within a semantic contract');
  }
  if (sameCandidate(event.candidate, state.candidate)) {
    throw new Error('approved candidate update must change the exact candidate identity');
  }
  const next = copy(state);
  next.candidate = structuredClone(event.candidate);
  next.stable = false;
  return appendEvent(next, {
    type: 'approved_candidate_updated_before_final_review',
    candidate: structuredClone(event.candidate)
  });
}

function recordDisposition(state, event) {
  if (UNTRUSTED_APPROVAL_DISPOSITIONS.includes(event.disposition)) {
    throw new Error(
      'trusted reviewer-output attestation is unavailable; caller-authored approval cannot authorize review'
    );
  }
  const finalDesignRevision = event.disposition === 'design_revision'
    && state.status === 'final_correction_required'
    && state.circuit_breaker_active === false;
  const preReviewDesignRevision = event.disposition === 'design_revision'
    && state.status === 'new_design_review_required'
    && !state.active_attempt_id;
  const strategyDisposition = state.status === 'strategy_escalation_required'
    && state.strategy_escalation?.status === 'required';
  if ((!state.circuit_breaker_active || state.status !== 'circuit_breaker_active')
    && !finalDesignRevision
    && !preReviewDesignRevision
    && !strategyDisposition) {
    throw new Error('breaker disposition requires an active circuit breaker or strategy escalation');
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
    if (preReviewDesignRevision
      && event.candidate.base_sha !== state.candidate.base_sha) {
      throw new Error('pre-review design revision cannot change the immutable base');
    }
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
    if (Object.hasOwn(next, 'strategy_escalation')) next.strategy_escalation = null;
  } else if (event.disposition === 'blocked_by_requirement') {
    next.status = 'blocked';
  } else {
    next.status = 'partial';
  }
  if (strategyDisposition && event.disposition !== 'design_revision') {
    next.strategy_escalation = {
      ...next.strategy_escalation,
      status: 'resolved',
      disposition: event.disposition
    };
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

function replayLegacyReviewerDisposition(state, event) {
  const next = copy(state);
  next.reviewer_dispositions ||= [];
  const record = structuredClone(event);
  delete record.type;
  next.reviewer_dispositions.push(structuredClone(record));
  return appendEvent(next, structuredClone(event));
}

function replayLegacyApprovalDisposition(state, event) {
  if (!UNTRUSTED_APPROVAL_DISPOSITIONS.includes(event.disposition)) {
    return recordDisposition(state, event);
  }
  requireString(event.reason, 'legacy breaker disposition reason');
  if (!Array.isArray(event.evidence_refs) || !event.evidence_refs.length) {
    throw new Error('legacy breaker disposition requires evidence_refs');
  }
  const strategyDisposition = state.status === 'strategy_escalation_required'
    && state.strategy_escalation?.status === 'required';
  const breakerDisposition = state.status === 'circuit_breaker_active'
    && state.circuit_breaker_active;
  if (!strategyDisposition && !breakerDisposition) {
    throw new Error('legacy approval disposition lacks an exhausted review state');
  }
  const next = copy(state);
  const disposition = {
    disposition: event.disposition,
    reason: event.reason,
    evidence_refs: [...event.evidence_refs],
    ...(event.reviewer_disposition_id
      ? { reviewer_disposition_id: event.reviewer_disposition_id }
      : {})
  };
  if (strategyDisposition) {
    disposition.candidate = structuredClone(state.candidate);
    next.status = 'final_approved';
    next.stable = true;
    next.strategy_escalation = {
      ...next.strategy_escalation,
      status: 'resolved',
      disposition: event.disposition
    };
  } else {
    next.status = 'approved';
  }
  next.circuit_breaker_active = false;
  next.dispositions.push(disposition);
  return appendEvent(next, { type: 'breaker_disposition_recorded', ...disposition });
}

function applyLegacyApprovalReconciliation(state, event) {
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id));
  const attempt = activeAttempts.find(({ attempt_id }) => attempt_id === event.attempt_id);
  if (event.prior_status !== state.status
    || !attempt || attempt.verdict !== 'needs_correction'
    || !UNTRUSTED_APPROVAL_DISPOSITIONS.includes(event.disposition)) {
    throw new Error('legacy untrusted approval reconciliation is inconsistent');
  }
  const next = copy(state);
  next.reviewer_dispositions ||= [];
  next.stable = false;
  if (attempt.attempt_type === 'final_integration_review') {
    const finalAttempts = activeAttempts.filter(({ attempt_type }) =>
      attempt_type === 'final_integration_review').length;
    next.status = 'strategy_escalation_required';
    next.circuit_breaker_active = false;
    next.strategy_escalation = {
      status: 'required',
      trigger: 'legacy_untrusted_final_approval',
      attempt_id: attempt.attempt_id,
      observed_final_attempts: finalAttempts,
      hard_limit: HARD_REVIEW_LIMITS.final_integration_reviews
    };
  } else if (attempt.attempt_type === 'correction_recheck') {
    next.status = 'circuit_breaker_active';
    next.circuit_breaker_active = true;
    next.strategy_escalation = null;
  } else {
    throw new Error('legacy untrusted approval does not follow an exhausted bounded review');
  }
  return appendEvent(next, structuredClone(event));
}

function legacyApprovalReconciliationEvent(state) {
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id));
  const attempt = activeAttempts.at(-1);
  const disposition = state.dispositions.at(-1);
  if (!attempt || attempt.verdict !== 'needs_correction'
    || !UNTRUSTED_APPROVAL_DISPOSITIONS.includes(disposition?.disposition)) {
    throw new Error('review lifecycle has no legacy untrusted approval to reconcile');
  }
  return {
    type: 'legacy_untrusted_approval_reconciled',
    prior_status: state.status,
    disposition: disposition.disposition,
    attempt_id: attempt.attempt_id
  };
}

function replayLifecycle(state, { allowLegacyUntrustedApproval = false } = {}) {
  const hasLegacyApprovalReconciliation = state.events.some(({ type }) =>
    type === 'legacy_untrusted_approval_reconciled');
  const replayLegacyApproval = allowLegacyUntrustedApproval || hasLegacyApprovalReconciliation;
  const migratedLegacy = !state.review_policy
    || state.events.some(({ type }) => type === 'policy_reconciled')
    || !Array.isArray(state.reviewer_dispositions);
  let replayed = (migratedLegacy ? createLegacyReviewLifecycle : createReviewLifecycle)({
    seam_id: state.seam_id,
    reviewer_identity: state.reviewer_identity,
    candidate: state.initial_candidate
  });
  for (const event of state.events) {
    if (event.type === 'attempt_started') replayed = startAttempt(replayed, event.attempt);
    else if (event.type === 'verdict_recorded') replayed = recordVerdict(replayed, event);
    else if (event.type === 'reviewer_disposition_recorded') {
      replayed = replayLegacyApproval
        ? replayLegacyReviewerDisposition(replayed, event)
        : recordReviewerDisposition(replayed, event);
    }
    else if (event.type === 'correction_recorded') replayed = recordCorrection(replayed, event);
    else if (event.type === 'breaker_disposition_recorded') {
      replayed = replayLegacyApproval
        ? replayLegacyApprovalDisposition(replayed, event)
        : recordDisposition(replayed, event);
    } else if (event.type === 'candidate_stabilized') {
      if (replayed.status !== 'approved' || replayed.circuit_breaker_active) {
        throw new Error('review lifecycle event history stabilizes an unapproved candidate');
      }
      const next = copy(replayed);
      next.stable = true;
      replayed = appendEvent(next, { type: 'candidate_stabilized' });
    } else if (event.type === 'policy_reconciled') {
      replayed = applyPolicyReconciliation(replayed, event);
    } else if (event.type === 'candidate_updated_before_review') {
      replayed = updateCandidateBeforeReview(replayed, event);
    } else if (event.type === 'approved_candidate_updated_before_final_review') {
      replayed = updateApprovedCandidateBeforeFinalReview(replayed, event);
    } else if (event.type === 'legacy_untrusted_approval_reconciled') {
      replayed = applyLegacyApprovalReconciliation(replayed, event);
    } else {
      throw new Error(`review lifecycle contains unsupported event: ${event.type}`);
    }
  }
  return replayed;
}

function policyReconciliationEvent(state) {
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id)
  );
  const primary = activeAttempts.filter(({ attempt_type }) =>
    attempt_type === 'initial_review' || attempt_type === 'new_design_review'
  );
  const finals = activeAttempts.filter(({ attempt_type }) =>
    attempt_type === 'final_integration_review'
  );
  const excess = [
    ...primary.slice(HARD_REVIEW_LIMITS.primary_reviews_per_semantic_contract),
    ...finals.slice(HARD_REVIEW_LIMITS.final_integration_reviews)
  ].map(({ attempt_id }) => attempt_id);
  return {
    type: 'policy_reconciled',
    review_policy: { ...HARD_REVIEW_LIMITS },
    prior_status: state.status,
    observed_attempt_counts: {
      primary_reviews: primary.length,
      correction_rechecks: activeAttempts.filter(({ attempt_type }) =>
        attempt_type === 'correction_recheck'
      ).length,
      final_integration_reviews: finals.length
    },
    historical_excess_attempt_ids: excess
  };
}

function applyPolicyReconciliation(state, event) {
  if (state.review_policy) throw new Error('review lifecycle policy is already reconciled');
  const expected = policyReconciliationEvent(state);
  if (JSON.stringify(event) !== JSON.stringify(expected)) {
    throw new Error('review lifecycle policy reconciliation event is inconsistent');
  }
  const next = copy(state);
  next.review_policy = { ...HARD_REVIEW_LIMITS };
  next.historical_excess_attempt_ids = [...event.historical_excess_attempt_ids];
  next.strategy_escalation = null;
  if (event.historical_excess_attempt_ids.length) {
    next.status = 'strategy_escalation_required';
    next.stable = false;
    next.strategy_escalation = {
      status: 'required',
      trigger: 'historical_review_attempts_exceeded_hard_limit',
      attempt_id: event.historical_excess_attempt_ids.at(-1),
      observed_final_attempts: event.observed_attempt_counts.final_integration_reviews,
      hard_limit: HARD_REVIEW_LIMITS.final_integration_reviews
    };
  }
  return appendEvent(next, event);
}

export function reconcileReviewLifecycle(state) {
  if (state?.review_policy) {
    try {
      return validateReviewLifecycle(state);
    } catch (validationError) {
      const unsafeApproval = UNTRUSTED_APPROVAL_DISPOSITIONS.includes(
        state.dispositions?.at(-1)?.disposition
      );
      const alreadyReconciled = state.events?.some(({ type }) =>
        type === 'legacy_untrusted_approval_reconciled');
      if (!unsafeApproval || alreadyReconciled) throw validationError;
      let replayed;
      try {
        replayed = replayLifecycle(state, { allowLegacyUntrustedApproval: true });
      } catch (error) {
        throw new Error(`legacy review lifecycle event integrity failed: ${error.message}`);
      }
      if (JSON.stringify(replayed) !== JSON.stringify(state)) {
        throw new Error('legacy review lifecycle state is inconsistent with its durable event history');
      }
      return applyLegacyApprovalReconciliation(
        state,
        legacyApprovalReconciliationEvent(state)
      );
    }
  }
  if (!state || state.schema_version !== 1) throw new Error('legacy review lifecycle must be schema v1');
  let replayed;
  try {
    replayed = replayLifecycle(state);
  } catch (error) {
    throw new Error(`legacy review lifecycle event integrity failed: ${error.message}`);
  }
  if (JSON.stringify(replayed) !== JSON.stringify(state)) {
    throw new Error('legacy review lifecycle state is inconsistent with its durable event history');
  }
  return applyPolicyReconciliation(state, policyReconciliationEvent(state));
}

export function applyReviewLifecycleEvent(state, event) {
  validateReviewLifecycle(state);
  if (!event || typeof event !== 'object') throw new Error('review lifecycle event is required');
  if (event.type === 'attempt_started') return startAttempt(state, event.attempt);
  if (event.type === 'verdict_recorded') return recordVerdict(state, event);
  if (event.type === 'reviewer_disposition_recorded') {
    return recordReviewerDisposition(state, event);
  }
  if (event.type === 'correction_recorded') return recordCorrection(state, event);
  if (event.type === 'candidate_updated_before_review') {
    return updateCandidateBeforeReview(state, event);
  }
  if (event.type === 'approved_candidate_updated_before_final_review') {
    return updateApprovedCandidateBeforeFinalReview(state, event);
  }
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
  if (state.reviewer_dispositions !== undefined
    && !Array.isArray(state.reviewer_dispositions)) {
    throw new Error('review lifecycle reviewer_dispositions must be an array');
  }
  if (typeof state.circuit_breaker_active !== 'boolean'
    || typeof state.correction_recheck_consumed !== 'boolean'
    || typeof state.stable !== 'boolean') {
    throw new Error('review lifecycle requires boolean breaker, recheck, and stable state');
  }
  if (JSON.stringify(state.review_policy) !== JSON.stringify(HARD_REVIEW_LIMITS)) {
    throw new Error('review lifecycle requires the hard review-attempt cardinality policy');
  }
  if (state.strategy_escalation !== null
    && (!state.strategy_escalation || typeof state.strategy_escalation !== 'object')) {
    throw new Error('review lifecycle strategy escalation must be an object or null');
  }
  if (!Array.isArray(state.historical_excess_attempt_ids)) {
    throw new Error('review lifecycle requires historical_excess_attempt_ids');
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
  const policyActiveAttempts = activeAttempts.filter(({ attempt_id }) =>
    !state.historical_excess_attempt_ids.includes(attempt_id)
  );
  if (policyActiveAttempts.filter(({ attempt_type }) =>
    attempt_type === 'initial_review' || attempt_type === 'new_design_review'
  ).length > state.review_policy.primary_reviews_per_semantic_contract) {
    throw new Error('only one primary review is permitted per semantic contract');
  }
  if (policyActiveAttempts.filter(({ attempt_type }) =>
    attempt_type === 'final_integration_review'
  ).length > state.review_policy.final_integration_reviews) {
    throw new Error('final integration review hard limit is exceeded');
  }
  if ((state.status === 'strategy_escalation_required')
    !== (state.strategy_escalation?.status === 'required')) {
    throw new Error('strategy escalation status is inconsistent');
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

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
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
    if (hasDuplicates(receipt[field])) {
      throw new Error(`assurance accounting ${field} identities must be globally unique`);
    }
  }
  if (recordedReviewAttemptIds && hasDuplicates(recordedReviewAttemptIds)) {
    throw new Error('review attempt IDs must be globally unique across lifecycle seams');
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
