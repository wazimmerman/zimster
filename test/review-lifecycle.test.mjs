import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle,
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
  state = start(state, 'new_design_review', 'attempt-redesign', {
    candidate: candidate({
      head_sha: '1'.repeat(40), semantic_contract_sha256: REVISED_CONTRACT
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
