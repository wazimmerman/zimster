import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_STATES,
  evaluateCandidateCompletion,
  evaluateRequirementMatrix,
  independentApprovalFor,
  selectSemanticLenses,
  validateReviewRecord
} from '../scripts/lib/semantic-assurance.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

function binding(...ids) {
  return ids.map((id) => ({ id, text: `Binding requirement ${id}.` }));
}

function matrixEntry(id, overrides = {}) {
  return {
    id,
    authoritative_text: `Binding requirement ${id}.`,
    source: `plan.md#${id.toLowerCase()}`,
    implementation_locations: ['scripts/example.mjs'],
    evidence_refs: [`evidence-${id}`],
    evidence_scope: {
      git_tree: 'candidate',
      environment: 'node-linux'
    },
    unavailable_proof: [],
    status: 'verified',
    intended_acceptance_claims: [`Claim ${id}.`],
    ...overrides
  };
}

function scopedEvidence(id, overrides = {}) {
  return {
    id: `evidence-${id}`,
    status: 'valid',
    requirement_ids: [id],
    establishes: [`Claim ${id}.`],
    does_not_establish: [],
    environment_scope: 'node-linux',
    git_commit: SHA_B,
    git_tree: 'c'.repeat(40),
    dirty_tree_fingerprint: CLEAN_FINGERPRINT,
    ...overrides
  };
}

function evaluate(entries, bindingRequirements, evidence) {
  return evaluateRequirementMatrix({
    bindingRequirements,
    matrix: {
      schema_version: 1,
      candidate_head: SHA_B,
      candidate_tree: 'c'.repeat(40),
      requirements: entries,
      observations: []
    },
    evidence
  });
}

test('a complete matrix derives only evidence-backed acceptance claims', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001'), matrixEntry('CLAIM-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [scopedEvidence('MATRIX-001'), scopedEvidence('CLAIM-001')]
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, {
    verified: 2,
    partially_verified: 0,
    unverified: 0,
    blocked_by_environment: 0,
    blocked_by_requirement: 0,
    not_applicable: 0
  });
  assert.deepEqual(result.allowed_claims, ['Claim CLAIM-001.', 'Claim MATRIX-001.']);
  assert.deepEqual(result.unverified_obligations, []);
});

test('a missing binding requirement blocks matrix completion', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [scopedEvidence('MATRIX-001')]
  );
  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /CLAIM-001.*missing/i);
});

test('stale evidence blocks only the affected requirement and claim', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001'), matrixEntry('CLAIM-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [
      scopedEvidence('MATRIX-001'),
      scopedEvidence('CLAIM-001', { status: 'stale' })
    ]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, ['Claim MATRIX-001.']);
  assert.match(result.unverified_obligations.join('\n'), /CLAIM-001.*stale/i);
});

test('narrow evidence cannot establish a broader compatibility claim', () => {
  const broadClaim = 'All custom locations, inheritance, precedence, abbreviations, and dynamic behavior are compatible.';
  const result = evaluate(
    [matrixEntry('CLAIM-001', { intended_acceptance_claims: [broadClaim] })],
    binding('CLAIM-001'),
    [scopedEvidence('CLAIM-001', {
      establishes: ['Default wrapper invocation and argument forwarding work.'],
      does_not_establish: [broadClaim],
      environment_scope: 'native-default-wrapper-harness'
    })]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, []);
  assert.match(result.unverified_obligations.join('\n'), /broader|not establish|scope/i);
});

test('evidence from a dirty checkout cannot prove the committed candidate tree', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001')],
    binding('MATRIX-001'),
    [scopedEvidence('MATRIX-001', { dirty_tree_fingerprint: 'd'.repeat(64) })]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, []);
  assert.match(result.unverified_obligations.join('\n'), /dirty checkout/i);
});

const COMPLETE_MATRIX = Object.freeze({
  valid: true,
  binding_requirement_ids: ['ASSURANCE-001'],
  counts: {
    verified: 1,
    partially_verified: 0,
    unverified: 0,
    blocked_by_environment: 0,
    blocked_by_requirement: 0,
    not_applicable: 0
  },
  allowed_claims: ['Candidate claim.'],
  unverified_obligations: [],
  issues: []
});

test('eligible Micro work can complete owner-only', () => {
  assert.deepEqual(evaluateCandidateCompletion({
    profile: 'micro',
    microEligible: true,
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [],
    candidateHead: SHA_B
  }), {
    state: COMPLETION_STATES.CANDIDATE_COMPLETE,
    allowed_claims: ['Candidate claim.'],
    review_id: null,
    reasons: []
  });
});

test('Standard and High-risk work with only self-review remain review pending', () => {
  const selfReview = review({
    review_type: 'self_review',
    owner_inline: true,
    verdict: 'approved'
  });
  for (const profile of ['standard', 'high-risk']) {
    const result = evaluateCandidateCompletion({
      profile,
      microEligible: false,
      ownerVerified: true,
      reviewUnavailable: false,
      matrixResult: COMPLETE_MATRIX,
      reviews: [selfReview],
      candidateHead: SHA_B,
      loadBearingReviewObligationsSatisfied: true
    });
    assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
    assert.match(result.reasons.join('\n'), /independent semantic review/i);
  }
});

test('complete Standard proof and exact independent approval reach candidate complete', () => {
  assert.deepEqual(evaluateCandidateCompletion({
    profile: 'standard',
    microEligible: false,
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: SHA_B
  }), {
    state: COMPLETION_STATES.CANDIDATE_COMPLETE,
    allowed_claims: ['Candidate claim.'],
    review_id: 'review-001',
    reasons: []
  });
});

test('missing or stale matrix proof blocks candidate completion', () => {
  const result = evaluateCandidateCompletion({
    profile: 'standard',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: {
      ...COMPLETE_MATRIX,
      valid: false,
      allowed_claims: [],
      unverified_obligations: ['MATRIX-001: evidence is stale']
    },
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: SHA_B
  });
  assert.equal(result.state, COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE);
  assert.deepEqual(result.allowed_claims, []);
});

test('approval for an older head cannot approve a corrected candidate', () => {
  const result = evaluateCandidateCompletion({
    profile: 'standard',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: 'd'.repeat(40)
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /candidate head/i);
});

test('unavailable independent review produces an honest non-candidate state', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: true,
    matrixResult: COMPLETE_MATRIX,
    reviews: [],
    candidateHead: SHA_B,
    loadBearingReviewObligationsSatisfied: true
  });
  assert.equal(result.state, COMPLETION_STATES.OWNER_VERIFIED_REVIEW_UNAVAILABLE);
  assert.deepEqual(result.allowed_claims, ['Candidate claim.']);
});

test('a correction invalidates prior approval until the bounded recheck', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review()],
    candidateHead: SHA_B,
    loadBearingReviewObligationsSatisfied: true,
    correctionPending: true
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /correction.*recheck/i);
});

test('High-risk work fails closed when load-bearing review obligations are not recorded', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: SHA_B
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /load-bearing review obligations/i);
});

test('convention-heavy framework signals select the framework-defaults lens', () => {
  for (const signal of [
    'build-tool',
    'wrapper-adapter',
    'configuration-loader',
    'cli-framework',
    'router',
    'orm',
    'plugin-system',
    'inherited-project-configuration',
    'generated-user-managed-topology'
  ]) {
    assert.deepEqual(selectSemanticLenses([signal]), [
      'framework-defaults-and-conventions'
    ]);
  }
  assert.deepEqual(selectSemanticLenses(['documentation']), []);
});

test('shared adapter or provider branching selects the shared-control-flow lens', () => {
  for (const signal of [
    'shared-adapter-control-flow',
    'shared-provider-control-flow',
    'shared-platform-control-flow',
    'shared-backend-control-flow'
  ]) {
    assert.deepEqual(selectSemanticLenses([signal]), ['shared-control-flow']);
  }
  assert.deepEqual(selectSemanticLenses(['isolated-adapter']), []);
});
