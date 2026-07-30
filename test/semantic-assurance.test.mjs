import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_STATES,
  independentApprovalFor,
  validateReviewRecord
} from '../scripts/lib/semantic-assurance.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function review(overrides = {}) {
  return {
    schema_version: 1,
    id: 'review-001',
    review_type: 'independent_review',
    owner_inline: false,
    base_sha: SHA_A,
    head_sha: SHA_B,
    reviewer_identity: 'reviewer-1',
    dispatch_record_id: null,
    clean_bounded_context: true,
    reviewed_requirement_ids: ['ASSURANCE-001'],
    intended_claims: ['Independent review is required for Standard work.'],
    semantic_lenses: ['mission-scope'],
    review_scope: 'integration',
    verdict: 'approved',
    findings: [],
    unverified_obligations: [],
    reviewed_at: '2026-07-30T12:00:00.000Z',
    review_package_id: 'package-001',
    checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED',
    ...overrides
  };
}

test('owner-inline review must be labeled self_review', () => {
  assert.throws(
    () => validateReviewRecord(review({ owner_inline: true })),
    /owner-inline review must use self_review/
  );
  assert.doesNotThrow(() => validateReviewRecord(review({
    owner_inline: true,
    review_type: 'self_review'
  })));
});

test('self-review never satisfies Standard or High-risk independent review', () => {
  const selfReview = review({
    review_type: 'self_review',
    owner_inline: true,
    verdict: 'approved'
  });
  for (const profile of ['standard', 'high-risk']) {
    assert.deepEqual(
      independentApprovalFor({
        profile,
        candidateHead: SHA_B,
        reviews: [selfReview],
        bindingRequirementIds: ['ASSURANCE-001'],
        intendedClaims: selfReview.intended_claims
      }),
      {
        approved: false,
        state: COMPLETION_STATES.REVIEW_PENDING,
        reason: 'independent semantic review is required'
      }
    );
  }
});

test('approved clean-context independent review satisfies the exact Standard candidate', () => {
  assert.deepEqual(
    independentApprovalFor({
      profile: 'standard',
      candidateHead: SHA_B,
      reviews: [review()],
      bindingRequirementIds: ['ASSURANCE-001'],
      intendedClaims: ['Independent review is required for Standard work.']
    }),
    {
      approved: true,
      state: COMPLETION_STATES.SEMANTIC_REVIEW_APPROVED,
      reviewId: 'review-001'
    }
  );
});

test('unchanged checkout is not semantic approval', () => {
  assert.deepEqual(
    independentApprovalFor({
      profile: 'standard',
      candidateHead: SHA_B,
      reviews: [review({ verdict: 'blocked_by_missing_evidence' })],
      bindingRequirementIds: ['ASSURANCE-001'],
      intendedClaims: ['Independent review is required for Standard work.']
    }),
    {
      approved: false,
      state: COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE,
      reason: 'independent review verdict is blocked_by_missing_evidence'
    }
  );
});
