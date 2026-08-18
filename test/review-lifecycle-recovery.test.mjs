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
    final_integration_reviews: 0
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
    verdict: 'approved'
  });
  assert.equal(state.status, 'REVIEW_LIFECYCLE_COMPLETE');
  assert.equal(state.aggregate.final_integration_reviews, 1);
});
