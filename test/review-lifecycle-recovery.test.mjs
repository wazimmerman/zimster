import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from '../scripts/lib/review-lifecycle.mjs';

function lifecycle() {
  const state = createReviewLifecycle({
    runId: 'run-1',
    seamId: 'release-seam',
    candidateDigest: 'candidate-a'
  });
  assert.deepEqual(state.limits, {
    correction_rechecks_per_cycle: 1,
    review_cycles_per_seam: 2,
    strategy_restarts_per_seam: 1,
    final_integration_reviews: 2,
    final_correction_waves: 1
  });
  return state;
}

function exhaustCorrectionCycle(state, reviewerId) {
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId, verdict: 'needs_correction'
  });
  state = applyReviewLifecycleEvent(state, { type: 'OWNER_CORRECTION' });
  return applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId, verdict: 'load_bearing_findings'
  });
}

function admitReplacementStrategy(state) {
  state = applyReviewLifecycleEvent(state, { type: 'ENTER_STRATEGY_ESCALATION' });
  return applyReviewLifecycleEvent(state, {
    type: 'STRATEGY_REVISION_ACCEPTED',
    previousCandidateDigest: 'candidate-a',
    candidateDigest: 'candidate-b',
    strategyReason: 'Replace the invalid shared-state design with an isolated state machine.',
    materialChange: true,
    focusedProofStatus: 'passed'
  });
}

test('one correction recheck with remaining load-bearing findings trips the circuit breaker', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'needs_correction'
  });
  assert.equal(state.status, 'OWNER_CORRECTION_REQUIRED');
  state = applyReviewLifecycleEvent(state, { type: 'OWNER_CORRECTION' });
  assert.equal(state.status, 'CORRECTION_RECHECK_REQUIRED');
  state = applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-1', verdict: 'load_bearing_findings'
  });
  assert.equal(state.status, 'CIRCUIT_BREAKER');
  assert.deepEqual(state.aggregate, {
    review_cycles: 1,
    initial_reviews: 1,
    correction_waves: 1,
    correction_rechecks: 1,
    final_integration_reviews: 0,
    final_correction_waves: 0,
    strategy_restarts: 0
  });
  const stopped = applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-1', verdict: 'approved'
  });
  assert.equal(stopped.status, 'CIRCUIT_BREAKER');
  assert.deepEqual(stopped.aggregate, state.aggregate);
});

test('correction recheck is bound to the initial reviewer', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'needs_correction'
  });
  state = applyReviewLifecycleEvent(state, { type: 'OWNER_CORRECTION' });
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-2', verdict: 'approved'
  }), /same reviewer|reviewer-1/i);
});

test('one material strategy revision opens cycle 2 without resetting seam history', () => {
  let state = exhaustCorrectionCycle(lifecycle(), 'reviewer-1');
  assert.equal(state.status, 'CIRCUIT_BREAKER');
  const exhausted = structuredClone(state.aggregate);

  const ordinaryRetry = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-2', verdict: 'approved',
    scope: 'renamed', attemptId: 'new-attempt', strategyChange: 'try again'
  });
  assert.equal(ordinaryRetry.status, 'CIRCUIT_BREAKER');
  assert.deepEqual(ordinaryRetry.aggregate, exhausted);
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'DESIGN_REVISION', candidateDigest: 'candidate-b',
    reviewerId: 'reviewer-2', scope: 'fresh-scope', attemptId: 'fresh-attempt'
  }), /cannot bypass|exhausted review cycle/i);

  state = applyReviewLifecycleEvent(state, { type: 'ENTER_STRATEGY_ESCALATION' });
  assert.equal(state.status, 'STRATEGY_ESCALATION_REQUIRES_OWNER');
  for (const event of [
    {
      type: 'STRATEGY_REVISION_ACCEPTED', previousCandidateDigest: 'candidate-a',
      candidateDigest: 'candidate-a', strategyReason: 'renamed only',
      materialChange: true, focusedProofStatus: 'passed'
    },
    {
      type: 'STRATEGY_REVISION_ACCEPTED', previousCandidateDigest: 'candidate-a',
      candidateDigest: 'candidate-b', strategyReason: 'ordinary correction',
      materialChange: false, focusedProofStatus: 'passed'
    },
    {
      type: 'STRATEGY_REVISION_ACCEPTED', previousCandidateDigest: 'candidate-a',
      candidateDigest: 'candidate-b', strategyReason: 'unproved replacement',
      materialChange: true, focusedProofStatus: 'failed'
    }
  ]) assert.throws(() => applyReviewLifecycleEvent(state, event), /replacement|material|proof/i);

  state = applyReviewLifecycleEvent(state, {
    type: 'STRATEGY_REVISION_ACCEPTED',
    previousCandidateDigest: 'candidate-a',
    candidateDigest: 'candidate-b',
    strategyReason: 'Replace the invalid shared-state design with an isolated state machine.',
    materialChange: true,
    focusedProofStatus: 'passed'
  });
  assert.equal(state.status, 'NEW_STRATEGY_REVIEW_REQUIRED');
  assert.equal(state.run_id, 'run-1');
  assert.equal(state.seam_id, 'release-seam');
  assert.equal(state.current_cycle, 2);
  assert.equal(state.aggregate.review_cycles, 2);
  assert.equal(state.aggregate.strategy_restarts, 1);
  assert.equal(state.aggregate.initial_reviews, 1);
  assert.equal(state.aggregate.correction_rechecks, 1);
  assert.equal(state.review_cycles[0].reviewer_id, 'reviewer-1');
  assert.equal(state.strategy_revisions[0].originating_cycle, 1);

  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-2', verdict: 'needs_correction'
  });
  state = applyReviewLifecycleEvent(state, { type: 'OWNER_CORRECTION' });
  assert.throws(() => applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-1', verdict: 'approved'
  }), /same reviewer|reviewer-2/i);
  state = applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-2', verdict: 'approved'
  });
  assert.equal(state.status, 'FINAL_INTEGRATION_REVIEW_REQUIRED');
  assert.equal(state.aggregate.initial_reviews, 2);
  assert.equal(state.aggregate.correction_waves, 2);
  assert.equal(state.aggregate.correction_rechecks, 2);
  assert.equal(state.aggregate.strategy_restarts, 1);
});

test('cycle 2 failure is terminal and cannot be relabeled into cycle 3', () => {
  let state = admitReplacementStrategy(exhaustCorrectionCycle(lifecycle(), 'reviewer-1'));
  state = exhaustCorrectionCycle(state, 'reviewer-2');
  assert.equal(state.status, 'BLOCKED');
  assert.deepEqual(state.aggregate, {
    review_cycles: 2,
    initial_reviews: 2,
    correction_waves: 2,
    correction_rechecks: 2,
    final_integration_reviews: 0,
    final_correction_waves: 0,
    strategy_restarts: 1
  });
  for (const event of [
    { type: 'ENTER_STRATEGY_ESCALATION' },
    {
      type: 'STRATEGY_REVISION_ACCEPTED', previousCandidateDigest: 'candidate-b',
      candidateDigest: 'candidate-c', strategyReason: 'third strategy',
      materialChange: true, focusedProofStatus: 'passed'
    },
    { type: 'INITIAL_REVIEW', reviewerId: 'reviewer-3', verdict: 'approved' },
    { type: 'DESIGN_REVISION', candidateDigest: 'candidate-c', scope: 'new-scope' }
  ]) {
    const stopped = applyReviewLifecycleEvent(state, event);
    assert.equal(stopped.status, 'BLOCKED');
    assert.equal(stopped.aggregate.review_cycles, 2);
    assert.equal(stopped.aggregate.strategy_restarts, 1);
  }
});

test('final exact-head integration review is separately reserved', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'approved'
  });
  assert.equal(state.status, 'FINAL_INTEGRATION_REVIEW_REQUIRED');
  assert.equal(state.aggregate.final_integration_reviews, 0);
  state = applyReviewLifecycleEvent(state, {
    type: 'FINAL_INTEGRATION_REVIEW',
    reviewerId: 'reviewer-1',
    candidateHead: 'a'.repeat(40),
    candidateTree: 'b'.repeat(40),
    reviewPackageId: 'package-final',
    semanticContractSha256: 'c'.repeat(64),
    reviewRecordId: 'review-final',
    dispatchRecordId: 'dispatch-reviewer-1',
    verdict: 'approved'
  });
  assert.equal(state.status, 'REVIEW_LIFECYCLE_COMPLETE');
  assert.equal(state.aggregate.final_integration_reviews, 1);
});

test('first failed final review permits one corrected-head final review', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'approved'
  });
  state = applyReviewLifecycleEvent(state, {
    type: 'FINAL_INTEGRATION_REVIEW',
    reviewerId: 'reviewer-1',
    candidateHead: 'a'.repeat(40),
    candidateTree: '1'.repeat(40),
    reviewPackageId: 'package-final-a',
    semanticContractSha256: '2'.repeat(64),
    reviewRecordId: 'review-final-a',
    dispatchRecordId: 'dispatch-reviewer-1',
    verdict: 'load_bearing_findings'
  });
  assert.equal(state.status, 'FINAL_OWNER_CORRECTION_REQUIRED');
  state = applyReviewLifecycleEvent(state, {
    type: 'FINAL_OWNER_CORRECTION', candidateDigest: 'candidate-b'
  });
  assert.equal(state.status, 'FINAL_INTEGRATION_REVIEW_REQUIRED');
  state = applyReviewLifecycleEvent(state, {
    type: 'FINAL_INTEGRATION_REVIEW',
    reviewerId: 'reviewer-1',
    candidateHead: 'b'.repeat(40),
    candidateTree: '3'.repeat(40),
    reviewPackageId: 'package-final-b',
    semanticContractSha256: '4'.repeat(64),
    reviewRecordId: 'review-final-b',
    dispatchRecordId: 'dispatch-reviewer-1',
    verdict: 'approved'
  });
  assert.equal(state.status, 'REVIEW_LIFECYCLE_COMPLETE');
  assert.equal(state.aggregate.final_correction_waves, 1);
  assert.equal(state.aggregate.final_integration_reviews, 2);
  assert.equal(state.approved_review.review_record_id, 'review-final-b');
  assert.equal(state.approved_review.candidate_head, 'b'.repeat(40));
});

test('second failed final review escalates and a third review is not admitted', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'approved'
  });
  for (const [index, head] of [['a', 'a'], ['b', 'b']]) {
    state = applyReviewLifecycleEvent(state, {
      type: 'FINAL_INTEGRATION_REVIEW',
      reviewerId: 'reviewer-1',
      candidateHead: head.repeat(40),
      candidateTree: index.repeat(40),
      reviewPackageId: `package-final-${index}`,
      semanticContractSha256: index.repeat(64),
      reviewRecordId: `review-final-${index}`,
      dispatchRecordId: 'dispatch-reviewer-1',
      verdict: 'load_bearing_findings'
    });
    if (index === 'a') {
      state = applyReviewLifecycleEvent(state, {
        type: 'FINAL_OWNER_CORRECTION', candidateDigest: 'candidate-b'
      });
    }
  }
  assert.equal(state.status, 'STRATEGY_ESCALATION_REQUIRES_OWNER');
  const stopped = applyReviewLifecycleEvent(state, {
    type: 'FINAL_INTEGRATION_REVIEW',
    reviewerId: 'reviewer-1',
    candidateHead: 'c'.repeat(40),
    candidateTree: 'c'.repeat(40),
    reviewPackageId: 'package-final-c',
    semanticContractSha256: 'c'.repeat(64),
    reviewRecordId: 'review-final-c',
    dispatchRecordId: 'dispatch-reviewer-1',
    verdict: 'approved'
  });
  assert.equal(stopped.status, 'STRATEGY_ESCALATION_REQUIRES_OWNER');
  assert.equal(stopped.aggregate.final_integration_reviews, 2);
});
