import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle,
  reconcileReviewLifecycle,
  validateAssuranceAccounting,
  validateReviewLifecycle
} from '../scripts/lib/review-lifecycle.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CORRECTED_HEAD = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const CONTRACT = 'e'.repeat(64);
const REVISED_CONTRACT = 'f'.repeat(64);
const CLEAN = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function candidate(overrides = {}) {
  return {
    base_sha: BASE,
    head_sha: HEAD,
    tree_sha: TREE,
    dirty_tree_fingerprint: CLEAN,
    semantic_contract_sha256: CONTRACT,
    ...overrides
  };
}

function lifecycle() {
  return createReviewLifecycle({
    seam_id: 'release-policy',
    reviewer_identity: 'reviewer-1',
    candidate: candidate()
  });
}

function start(state, attempt_type, attempt_id, overrides = {}) {
  return applyReviewLifecycleEvent(state, {
    type: 'attempt_started',
    attempt: {
      attempt_type,
      attempt_id,
      seam_id: 'release-policy',
      reviewer_identity: 'reviewer-1',
      review_package_id: `package-${attempt_id}`,
      candidate: candidate(),
      ...overrides
    }
  });
}

function verdict(state, attempt_id, value, findings = []) {
  return applyReviewLifecycleEvent(state, {
    type: 'verdict_recorded',
    attempt_id,
    verdict: value,
    findings
  });
}

function findingFingerprint(attemptId, finding) {
  return createHash('sha256').update(JSON.stringify({
    attempt_id: attemptId,
    severity: finding.severity,
    summary: finding.summary,
    evidence: finding.evidence || null
  })).digest('hex');
}

test('initial review permits one same-reviewer correction recheck and consumes it', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'needs_correction', [{
    severity: 'Important', summary: 'The breaker is bypassable.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded',
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = start(state, 'correction_recheck', 'attempt-recheck', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = verdict(state, 'attempt-recheck', 'approved');
  assert.equal(state.status, 'approved');
  assert.equal(state.correction_recheck_consumed, true);
  assert.equal(state.attempts.length, 2);
  assert.doesNotThrow(() => validateReviewLifecycle(state));
});

test('owner may accumulate exact-candidate corrections before the single recheck starts', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'needs_correction', [{
    severity: 'Important', summary: 'The release gate contradicts deferred proof.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded',
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  const finalCorrection = candidate({
    head_sha: '1'.repeat(40),
    tree_sha: '2'.repeat(40)
  });
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded',
    candidate: finalCorrection
  });
  assert.equal(state.status, 'correction_recheck_required');
  assert.equal(state.correction_recheck_consumed, false);
  assert.deepEqual(state.candidate, finalCorrection);
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'correction_recorded', candidate: finalCorrection
  }), /must change the exact candidate identity/i);
  state = start(state, 'correction_recheck', 'attempt-recheck', {
    candidate: finalCorrection
  });
  assert.equal(state.correction_recheck_consumed, true);
  assert.doesNotThrow(() => validateReviewLifecycle(state));
});

test('an approved verdict rejects load-bearing findings', () => {
  const state = start(lifecycle(), 'initial_review', 'attempt-initial');
  assert.throws(() => verdict(state, 'attempt-initial', 'approved', [{
    severity: 'Important', summary: 'The approved path still has a bypass.'
  }]), /approved.*load-bearing|load-bearing.*approved/i);
});

test('a failed recheck persists the circuit breaker and rejects every shopping path', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'needs_correction', [{
    severity: 'Critical', summary: 'Completion can still bypass the lifecycle.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded',
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = start(state, 'correction_recheck', 'attempt-recheck', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = verdict(state, 'attempt-recheck', 'needs_correction', [{
    severity: 'Important', summary: 'Fresh reviewers can bypass the breaker.'
  }]);

  assert.equal(state.status, 'circuit_breaker_active');
  assert.equal(state.correction_recheck_consumed, true);
  for (const [attempt_type, reviewer_identity] of [
    ['correction_recheck', 'reviewer-1'],
    ['initial_review', 'replacement-reviewer'],
    ['new_design_review', 'replacement-reviewer'],
    ['final_integration_review', 'reviewer-1']
  ]) {
    assert.throws(() => start(state, attempt_type, `shopping-${attempt_type}`, {
      reviewer_identity,
      candidate: candidate({ head_sha: CORRECTED_HEAD })
    }), /circuit breaker|recheck.*consumed|reviewer/i);
  }
});

test('only explicit supported breaker dispositions resolve a failed recheck', () => {
  function broken() {
    let state = start(lifecycle(), 'initial_review', 'attempt-initial');
    state = verdict(state, 'attempt-initial', 'needs_correction', [{
      severity: 'Important', summary: 'A load-bearing defect.'
    }]);
    state = applyReviewLifecycleEvent(state, {
      type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
    });
    state = start(state, 'correction_recheck', 'attempt-recheck', {
      candidate: candidate({ head_sha: CORRECTED_HEAD })
    });
    return verdict(state, 'attempt-recheck', 'needs_correction', [{
      severity: 'Important', summary: 'Still load-bearing.'
    }]);
  }

  assert.throws(() => applyReviewLifecycleEvent(broken(), {
    type: 'breaker_disposition_recorded', disposition: 'waived', reason: 'ship it'
  }), /unsupported.*disposition/i);

  const rebutted = applyReviewLifecycleEvent(broken(), {
    type: 'breaker_disposition_recorded',
    disposition: 'reviewer_rebutted_with_evidence',
    reason: 'The reported path is unreachable under the exact candidate.',
    evidence_refs: ['receipt-rebuttal']
  });
  assert.equal(rebutted.status, 'approved');

  const blocked = applyReviewLifecycleEvent(broken(), {
    type: 'breaker_disposition_recorded',
    disposition: 'blocked_by_requirement',
    reason: 'Two binding requirements contradict each other.',
    evidence_refs: ['decision-contradiction']
  });
  assert.equal(blocked.status, 'blocked');

  const deferred = applyReviewLifecycleEvent(broken(), {
    type: 'breaker_disposition_recorded',
    disposition: 'non_load_bearing_deferral',
    reason: 'The remaining observation cannot affect an acceptance claim.',
    evidence_refs: ['decision-deferral']
  });
  assert.equal(deferred.status, 'approved');

  const partial = applyReviewLifecycleEvent(broken(), {
    type: 'breaker_disposition_recorded',
    disposition: 'partial_or_blocked',
    reason: 'Required live proof is unavailable.',
    evidence_refs: ['receipt-unavailable']
  });
  assert.equal(partial.status, 'partial');
});

test('a design revision resets accounting only for a genuinely new semantic candidate', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'needs_correction', [{
    severity: 'Important', summary: 'The design contract is internally inconsistent.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = start(state, 'correction_recheck', 'attempt-recheck', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = verdict(state, 'attempt-recheck', 'needs_correction', [{
    severity: 'Important', summary: 'The design remains inconsistent.'
  }]);

  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'design_revision',
    reason: 'Rename the review.',
    candidate: candidate({ head_sha: '1'.repeat(40) }),
    evidence_refs: ['revision-note']
  }), /semantic candidate.*change/i);

  state = applyReviewLifecycleEvent(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'design_revision',
    reason: 'The binding design and implementation contract changed.',
    candidate: candidate({
      head_sha: '1'.repeat(40),
      semantic_contract_sha256: REVISED_CONTRACT
    }),
    evidence_refs: ['revision-note']
  });
  assert.equal(state.status, 'new_design_review_required');
  assert.equal(state.correction_recheck_consumed, false);
  assert.equal(state.invalidated_attempt_ids.length, 2);
  state = applyReviewLifecycleEvent(state, {
    type: 'candidate_updated_before_review',
    candidate: candidate({
      head_sha: '2'.repeat(40), semantic_contract_sha256: REVISED_CONTRACT
    })
  });
  assert.equal(state.status, 'new_design_review_required');
  assert.equal(state.attempts.length, 2);
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'candidate_updated_before_review',
    candidate: candidate({
      head_sha: '3'.repeat(40), semantic_contract_sha256: '4'.repeat(64)
    })
  }), /semantic contract|design revision/i);
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'candidate_updated_before_review',
    candidate: candidate({
      base_sha: '5'.repeat(40),
      head_sha: '3'.repeat(40),
      semantic_contract_sha256: REVISED_CONTRACT
    })
  }), /base.*immutable|immutable.*base/i);
  state = start(state, 'new_design_review', 'attempt-redesign', {
    candidate: candidate({
      head_sha: '2'.repeat(40), semantic_contract_sha256: REVISED_CONTRACT
    })
  });
  assert.equal(state.attempts.at(-1).attempt_type, 'new_design_review');
});

test('final integration review is separate and requires a stable breaker-free candidate', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  assert.throws(() => start(state, 'final_integration_review', 'attempt-final'), /stable/i);
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final');
  state = verdict(state, 'attempt-final', 'approved');
  assert.equal(state.status, 'final_approved');
  assert.equal(state.correction_recheck_consumed, false);
});

test('approved semantics may advance before final review and revoke prior stabilization', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  const exactCandidate = candidate({
    head_sha: CORRECTED_HEAD,
    tree_sha: '1'.repeat(40)
  });
  state = applyReviewLifecycleEvent(state, {
    type: 'approved_candidate_updated_before_final_review',
    candidate: exactCandidate
  });
  assert.equal(state.status, 'approved');
  assert.equal(state.stable, false);
  assert.deepEqual(state.candidate, exactCandidate);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.events.at(-1).type, 'approved_candidate_updated_before_final_review');
  assert.doesNotThrow(() => validateReviewLifecycle(state));

  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'approved_candidate_updated_before_final_review',
    candidate: candidate({
      head_sha: '2'.repeat(40),
      semantic_contract_sha256: REVISED_CONTRACT
    })
  }), /semantic contract|design revision/i);
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  const restabilizationCandidate = candidate({
    head_sha: '3'.repeat(40),
    tree_sha: '4'.repeat(40)
  });
  state = applyReviewLifecycleEvent(state, {
    type: 'approved_candidate_updated_before_final_review',
    candidate: restabilizationCandidate
  });
  assert.equal(state.stable, false);
  assert.deepEqual(state.candidate, restabilizationCandidate);

  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final', {
    candidate: restabilizationCandidate
  });
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'approved_candidate_updated_before_final_review',
    candidate: candidate({ head_sha: '5'.repeat(40) })
  }), /approved|active|before final/i);
});

test('a final-review correction invalidates stability but does not expand the seam recheck budget', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final');
  state = verdict(state, 'attempt-final', 'needs_correction', [{
    severity: 'Important', summary: 'Exact-head integration found a defect.'
  }]);
  assert.equal(state.status, 'final_correction_required');
  assert.equal(state.circuit_breaker_active, false);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  assert.equal(state.status, 'approved');
  assert.equal(state.stable, false);
  assert.equal(state.correction_recheck_consumed, false);
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final-2', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = verdict(state, 'attempt-final-2', 'approved');
  assert.equal(state.status, 'final_approved');
});

test('a second failed final review exhausts the hard lifecycle and persists strategy escalation', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final-1');
  state = verdict(state, 'attempt-final-1', 'needs_correction', [{
    severity: 'Important', summary: 'First exact-head defect.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final-2', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  state = verdict(state, 'attempt-final-2', 'needs_correction', [{
    severity: 'Important', summary: 'Distinct second exact-head defect.'
  }]);

  assert.equal(state.status, 'strategy_escalation_required');
  assert.deepEqual(state.strategy_escalation, {
    status: 'required',
    trigger: 'final_review_attempts_exhausted',
    attempt_id: 'attempt-final-2',
    observed_final_attempts: 2,
    hard_limit: 2
  });
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'correction_recorded', candidate: candidate({ head_sha: '1'.repeat(40) })
  }), /strategy escalation|exhausted|correction/i);
  assert.throws(() => start(state, 'final_integration_review', 'attempt-final-3', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  }), /strategy escalation|exhausted|not allowed/i);
  assert.doesNotThrow(() => validateReviewLifecycle(state));
});

test('evidence-backed approval dispositions resolve exhausted final review as final approval', () => {
  function exhausted() {
    let state = start(lifecycle(), 'initial_review', 'attempt-initial');
    state = verdict(state, 'attempt-initial', 'approved');
    state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
    state = start(state, 'final_integration_review', 'attempt-final-1');
    state = verdict(state, 'attempt-final-1', 'needs_correction', [{
      severity: 'Important', summary: 'First exact-head defect.'
    }]);
    state = applyReviewLifecycleEvent(state, {
      type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
    });
    state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
    state = start(state, 'final_integration_review', 'attempt-final-2', {
      candidate: candidate({ head_sha: CORRECTED_HEAD })
    });
    return verdict(state, 'attempt-final-2', 'needs_correction', [{
      severity: 'Important', summary: 'Exact-head evidence was incomplete.'
    }]);
  }

  const finding = {
    severity: 'Important', summary: 'Exact-head evidence was incomplete.'
  };
  const authenticatedEvidence = {
    receipt_type: 'verification',
    receipt_id: 'verification-current-candidate',
    execution_id: 'execution-current-candidate',
    authentication: 'governed-execution-v1',
    candidate: candidate({ head_sha: CORRECTED_HEAD }),
    environment: { platform: 'linux', arch: 'x64', node: process.version },
    step_ids: ['rebut-final-finding'],
    finding_fingerprints: [findingFingerprint('attempt-final-2', finding)]
  };

  assert.throws(() => applyReviewLifecycleEvent(exhausted(), {
    type: 'breaker_disposition_recorded',
    disposition: 'reviewer_rebutted_with_evidence',
    reason: 'A forged string must not authorize release.',
    evidence_refs: ['does-not-exist']
  }), /authenticated.*evidence|evidence.*authenticated/i);
  assert.throws(() => applyReviewLifecycleEvent(exhausted(), {
    type: 'breaker_disposition_recorded',
    disposition: 'reviewer_rebutted_with_evidence',
    reason: 'Evidence for another candidate must not authorize release.',
    evidence_refs: [{
      ...authenticatedEvidence,
      candidate: candidate()
    }]
  }), /candidate/i);
  assert.throws(() => applyReviewLifecycleEvent(exhausted(), {
    type: 'breaker_disposition_recorded',
    disposition: 'reviewer_rebutted_with_evidence',
    reason: 'Evidence must rebut every load-bearing finding.',
    evidence_refs: [{
      ...authenticatedEvidence,
      finding_fingerprints: ['0'.repeat(64)]
    }]
  }), /finding/i);

  for (const disposition of [
    'reviewer_rebutted_with_evidence',
    'non_load_bearing_deferral'
  ]) {
    const state = applyReviewLifecycleEvent(exhausted(), {
      type: 'breaker_disposition_recorded',
      disposition,
      reason: 'Candidate-bound evidence resolves the final finding without a source change.',
      evidence_refs: [authenticatedEvidence]
    });
    assert.equal(state.status, 'final_approved');
    assert.equal(state.stable, true);
    assert.equal(state.strategy_escalation.status, 'resolved');
    assert.deepEqual(state.dispositions.at(-1).candidate, candidate({ head_sha: CORRECTED_HEAD }));
    assert.doesNotThrow(() => validateReviewLifecycle(state, { requireFinalApproval: true }));
    assert.throws(() => start(state, 'final_integration_review', 'attempt-final-3', {
      candidate: candidate({ head_sha: CORRECTED_HEAD })
    }), /exhausted|not allowed|final.*approval/i);
  }
});

test('only a material semantic design revision resets an exhausted review epoch', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  for (const [index, head] of [[1, HEAD], [2, CORRECTED_HEAD]]) {
    state = start(state, 'final_integration_review', `attempt-final-${index}`, {
      candidate: candidate({ head_sha: head })
    });
    state = verdict(state, `attempt-final-${index}`, 'needs_correction', [{
      severity: 'Important', summary: `Final defect ${index}.`
    }]);
    if (index === 1) {
      state = applyReviewLifecycleEvent(state, {
        type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
      });
      state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
    }
  }
  assert.equal(state.status, 'strategy_escalation_required');
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'design_revision',
    reason: 'Rename the same contract.',
    candidate: candidate({ head_sha: '1'.repeat(40) }),
    evidence_refs: ['revision-note']
  }), /semantic candidate.*change|contract.*change/i);

  state = applyReviewLifecycleEvent(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'design_revision',
    reason: 'Binding semantics materially changed.',
    candidate: candidate({
      head_sha: '1'.repeat(40),
      semantic_contract_sha256: REVISED_CONTRACT
    }),
    evidence_refs: ['material-contract-diff']
  });
  assert.equal(state.status, 'new_design_review_required');
  assert.equal(state.strategy_escalation, null);
  assert.equal(state.invalidated_attempt_ids.length, 3);
  state = start(state, 'new_design_review', 'attempt-new-epoch', {
    candidate: candidate({
      head_sha: '1'.repeat(40), semantic_contract_sha256: REVISED_CONTRACT
    })
  });
  assert.equal(state.attempts.at(-1).attempt_type, 'new_design_review');
});

test('legacy excess attempts migrate losslessly into durable strategy escalation', () => {
  let legacy = start(lifecycle(), 'initial_review', 'attempt-initial');
  legacy = verdict(legacy, 'attempt-initial', 'approved');
  legacy = applyReviewLifecycleEvent(legacy, { type: 'candidate_stabilized' });
  legacy = start(legacy, 'final_integration_review', 'attempt-final-1');
  legacy = verdict(legacy, 'attempt-final-1', 'needs_correction', [{
    severity: 'Important', summary: 'First legacy final defect.'
  }]);
  legacy = applyReviewLifecycleEvent(legacy, {
    type: 'correction_recorded', candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  legacy = applyReviewLifecycleEvent(legacy, { type: 'candidate_stabilized' });
  legacy = start(legacy, 'final_integration_review', 'attempt-final-2', {
    candidate: candidate({ head_sha: CORRECTED_HEAD })
  });
  legacy = verdict(legacy, 'attempt-final-2', 'needs_correction', [{
    severity: 'Important', summary: 'Second legacy final defect.'
  }]);

  delete legacy.review_policy;
  delete legacy.strategy_escalation;
  delete legacy.historical_excess_attempt_ids;
  legacy.status = 'final_correction_required';
  const thirdCandidate = candidate({ head_sha: '1'.repeat(40) });
  legacy.candidate = thirdCandidate;
  legacy.status = 'approved';
  legacy.events.push({ type: 'correction_recorded', candidate: thirdCandidate });
  legacy.stable = true;
  legacy.events.push({ type: 'candidate_stabilized' });
  const thirdAttempt = {
    attempt_type: 'final_integration_review',
    attempt_id: 'attempt-final-3',
    seam_id: 'release-policy',
    reviewer_identity: 'reviewer-1',
    review_package_id: 'package-attempt-final-3',
    candidate: thirdCandidate
  };
  legacy.attempts.push({ ...thirdAttempt, verdict: 'approved', findings: [] });
  legacy.events.push({ type: 'attempt_started', attempt: thirdAttempt });
  legacy.events.push({
    type: 'verdict_recorded',
    attempt_id: 'attempt-final-3',
    verdict: 'approved',
    findings: []
  });
  legacy.status = 'final_approved';

  const migrated = reconcileReviewLifecycle(legacy);
  assert.equal(migrated.attempts.length, 4);
  assert.equal(migrated.status, 'strategy_escalation_required');
  assert.deepEqual(migrated.historical_excess_attempt_ids, ['attempt-final-3']);
  assert.equal(
    migrated.strategy_escalation.trigger,
    'historical_review_attempts_exceeded_hard_limit'
  );
  assert.equal(migrated.events.at(-1).type, 'policy_reconciled');
  assert.doesNotThrow(() => validateReviewLifecycle(migrated));
  assert.throws(() => start(migrated, 'final_integration_review', 'attempt-final-4', {
    candidate: thirdCandidate
  }), /strategy escalation|exhausted|not allowed/i);
});

test('a final-review correction that changes semantic meaning requires explicit design revision', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final');
  state = verdict(state, 'attempt-final', 'needs_correction', [{
    severity: 'Important', summary: 'Exact-head integration requires a semantic contract revision.'
  }]);
  state = applyReviewLifecycleEvent(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'design_revision',
    reason: 'The final correction changes stable semantic meaning.',
    candidate: candidate({
      head_sha: CORRECTED_HEAD,
      semantic_contract_sha256: REVISED_CONTRACT
    }),
    evidence_refs: ['final-review-finding']
  });
  assert.equal(state.status, 'new_design_review_required');
  assert.equal(state.stable, false);
  assert.equal(state.correction_recheck_consumed, false);
  assert.deepEqual(state.invalidated_attempt_ids, ['attempt-initial', 'attempt-final']);
});

test('assurance accounting fails closed for missing agents, attempts, budgets, or nesting violations', () => {
  const valid = {
    schema_version: 1,
    candidate_head: HEAD,
    candidate_tree: TREE,
    observed_agent_ids: ['agent-reviewer'],
    dispatch_agent_ids: ['agent-reviewer'],
    budget_agent_ids: ['agent-reviewer'],
    observed_review_attempt_ids: ['attempt-final'],
    recorded_review_attempt_ids: ['attempt-final'],
    recorded_review_attempt_counts: {
      correction_rechecks: 0,
      final_integration_reviews: 1
    },
    budget_review_attempt_counts: {
      correction_rechecks: 0,
      final_integration_reviews: 1
    },
    observed_max_depth: 1,
    allowed_max_depth: 1,
    reconciliation_complete: true
  };
  assert.doesNotThrow(() => validateAssuranceAccounting(valid, {
    candidateHead: HEAD,
    candidateTree: TREE,
    recordedReviewAttemptIds: ['attempt-final'],
    recordedReviewAttemptCounts: {
      correction_rechecks: 0,
      final_integration_reviews: 1
    },
    requiredReviewerIdentities: ['agent-reviewer']
  }));
  for (const mutation of [
    (row) => { row.dispatch_agent_ids = []; },
    (row) => { row.budget_agent_ids = []; },
    (row) => { row.recorded_review_attempt_ids = []; },
    (row) => { row.budget_review_attempt_counts.final_integration_reviews = 0; },
    (row) => { row.observed_max_depth = 2; },
    (row) => { row.allowed_max_depth = 2; row.observed_max_depth = 2; },
    (row) => { row.reconciliation_complete = false; }
  ]) {
    const receipt = structuredClone(valid);
    mutation(receipt);
    assert.throws(() => validateAssuranceAccounting(receipt, {
      candidateHead: HEAD,
      candidateTree: TREE,
      recordedReviewAttemptIds: ['attempt-final'],
      recordedReviewAttemptCounts: {
        correction_rechecks: 0,
        final_integration_reviews: 1
      },
      requiredReviewerIdentities: ['agent-reviewer']
    }), /reconcil|account|nest|depth|complete/i);
  }
  assert.throws(() => validateAssuranceAccounting(valid, {
    candidateHead: HEAD,
    candidateTree: TREE,
    recordedReviewAttemptIds: ['different-attempt'],
    recordedReviewAttemptCounts: {
      correction_rechecks: 0,
      final_integration_reviews: 1
    },
    requiredReviewerIdentities: ['agent-reviewer']
  }), /lifecycle.*attempt|attempt.*lifecycle/i);
  assert.throws(() => validateAssuranceAccounting(valid, {
    candidateHead: HEAD,
    candidateTree: TREE,
    recordedReviewAttemptIds: ['attempt-final'],
    recordedReviewAttemptCounts: {
      correction_rechecks: 0,
      final_integration_reviews: 1
    },
    requiredReviewerIdentities: ['unobserved-reviewer']
  }), /reviewer.*observed|observed.*reviewer/i);
  assert.throws(() => validateAssuranceAccounting(valid, {
    candidateHead: HEAD,
    candidateTree: TREE,
    recordedReviewAttemptIds: ['attempt-final', 'attempt-final'],
    recordedReviewAttemptCounts: {
      correction_rechecks: 0,
      final_integration_reviews: 2
    },
    requiredReviewerIdentities: ['agent-reviewer']
  }), /attempt.*globally unique|duplicate.*attempt/i);
});

test('lifecycle validation rejects hand-edited breaker and approval state', () => {
  let state = start(lifecycle(), 'initial_review', 'attempt-initial');
  state = verdict(state, 'attempt-initial', 'approved');
  state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
  state = start(state, 'final_integration_review', 'attempt-final');
  state = verdict(state, 'attempt-final', 'approved');
  assert.doesNotThrow(() => validateReviewLifecycle(state, { requireFinalApproval: true }));

  for (const mutate of [
    (row) => { row.status = 'approved'; },
    (row) => { row.attempts.at(-1).verdict = 'needs_correction'; },
    (row) => { row.events.pop(); },
    (row) => { row.reviewer_identity = 'replacement-reviewer'; }
  ]) {
    const edited = structuredClone(state);
    mutate(edited);
    assert.throws(() => validateReviewLifecycle(edited), /integrity|inconsistent|approval|reviewer/i);
  }
});
