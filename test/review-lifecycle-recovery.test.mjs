import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from '../scripts/lib/review-lifecycle.mjs';

function lifecycle() {
  return createReviewLifecycle({
    runId: 'run-1',
    seamId: 'release-seam',
    candidateDigest: 'candidate-a'
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
    initial_reviews: 1,
    correction_waves: 1,
    correction_rechecks: 1,
    final_integration_reviews: 0,
    final_correction_waves: 0
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

test('design revision changes the candidate without replenishing aggregate review history', () => {
  let state = lifecycle();
  state = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-1', verdict: 'needs_correction'
  });
  state = applyReviewLifecycleEvent(state, { type: 'OWNER_CORRECTION' });
  state = applyReviewLifecycleEvent(state, {
    type: 'CORRECTION_RECHECK', reviewerId: 'reviewer-1', verdict: 'load_bearing_findings'
  });
  const aggregate = structuredClone(state.aggregate);
  state = applyReviewLifecycleEvent(state, {
    type: 'DESIGN_REVISION', candidateDigest: 'candidate-b'
  });
  assert.equal(state.candidate.revision, 1);
  assert.equal(state.candidate.digest, 'candidate-b');
  assert.equal(state.status, 'STRATEGY_ESCALATION_REQUIRES_OWNER');
  assert.deepEqual(state.aggregate, aggregate);
  const stopped = applyReviewLifecycleEvent(state, {
    type: 'INITIAL_REVIEW', reviewerId: 'reviewer-2', verdict: 'approved'
  });
  assert.equal(stopped.status, 'STRATEGY_ESCALATION_REQUIRES_OWNER');
  assert.deepEqual(stopped.aggregate, aggregate);
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
