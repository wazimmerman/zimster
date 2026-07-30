const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const REVIEW_TYPES = Object.freeze([
  'self_review',
  'independent_review'
]);

export const CHECKOUT_INTEGRITY_RESULTS = Object.freeze([
  'REVIEW_CHECKOUT_UNCHANGED',
  'REVIEW_CHECKOUT_CHANGED',
  'REVIEW_CHECKOUT_UNVERIFIED'
]);

export const COMPLETION_STATES = Object.freeze({
  IMPLEMENTATION_COMPLETE: 'IMPLEMENTATION_COMPLETE',
  OWNER_VERIFIED: 'OWNER_VERIFIED',
  REVIEW_PENDING: 'REVIEW_PENDING',
  SEMANTIC_REVIEW_APPROVED: 'SEMANTIC_REVIEW_APPROVED',
  OWNER_VERIFIED_REVIEW_UNAVAILABLE: 'OWNER_VERIFIED_REVIEW_UNAVAILABLE',
  PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  CANDIDATE_COMPLETE: 'CANDIDATE_COMPLETE',
  BLOCKED_BY_MISSING_EVIDENCE: 'BLOCKED_BY_MISSING_EVIDENCE'
});

function requireString(record, field) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    throw new Error(`review record requires ${field}`);
  }
}

export function validateReviewRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('review record must be an object');
  }
  if (!REVIEW_TYPES.includes(record.review_type)) {
    throw new Error('review_type must be self_review or independent_review');
  }
  if (record.owner_inline === true && record.review_type !== 'self_review') {
    throw new Error('owner-inline review must use self_review');
  }
  for (const field of ['id', 'review_package_id']) requireString(record, field);
  for (const field of ['base_sha', 'head_sha']) {
    if (!SHA_PATTERN.test(record[field] || '')) {
      throw new Error(`${field} must be an immutable 40-character SHA`);
    }
  }
  if (!record.reviewer_identity && !record.dispatch_record_id) {
    throw new Error('review record requires reviewer_identity or dispatch_record_id');
  }
  if (typeof record.clean_bounded_context !== 'boolean') {
    throw new Error('review record requires clean_bounded_context');
  }
  for (const field of [
    'reviewed_requirement_ids',
    'intended_claims',
    'semantic_lenses',
    'findings',
    'unverified_obligations'
  ]) {
    if (!Array.isArray(record[field])) throw new Error(`review record requires ${field}`);
  }
  if (!['seam', 'integration'].includes(record.review_scope)) {
    throw new Error('review_scope must be seam or integration');
  }
  if (!['approved', 'needs_correction', 'blocked_by_missing_evidence', 'self_review_only'].includes(record.verdict)) {
    throw new Error('review record has an unsupported verdict');
  }
  if (!CHECKOUT_INTEGRITY_RESULTS.includes(record.checkout_integrity_result)) {
    throw new Error('review record has an unsupported checkout_integrity_result');
  }
  if (!record.reviewed_at || Number.isNaN(Date.parse(record.reviewed_at))) {
    throw new Error('reviewed_at must be an ISO-compatible timestamp');
  }
  return record;
}

export function independentApprovalFor({
  profile,
  candidateHead,
  reviews,
  bindingRequirementIds = [],
  intendedClaims = []
}) {
  if (!['standard', 'high-risk'].includes(profile)) {
    throw new Error('independentApprovalFor requires standard or high-risk profile');
  }
  const independentReviews = reviews.filter((record) => {
    validateReviewRecord(record);
    return record.review_type === 'independent_review';
  });
  if (!independentReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent semantic review is required'
    };
  }
  const exactHeadReviews = independentReviews.filter(
    (record) => record.head_sha === candidateHead
  );
  if (!exactHeadReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the candidate head'
    };
  }
  const review = exactHeadReviews.at(-1);
  if (review.verdict !== 'approved') {
    return {
      approved: false,
      state: review.verdict === 'blocked_by_missing_evidence'
        ? COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE
        : COMPLETION_STATES.REVIEW_PENDING,
      reason: `independent review verdict is ${review.verdict}`
    };
  }
  if (!review.clean_bounded_context) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review did not receive a clean bounded context'
    };
  }
  if (review.checkout_integrity_result !== 'REVIEW_CHECKOUT_UNCHANGED') {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'review checkout integrity was not established'
    };
  }
  const missingRequirements = bindingRequirementIds.filter(
    (id) => !review.reviewed_requirement_ids.includes(id)
  );
  const missingClaims = intendedClaims.filter(
    (claim) => !review.intended_claims.includes(claim)
  );
  if (missingRequirements.length || missingClaims.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE,
      reason: 'independent review did not cover every binding requirement and intended claim'
    };
  }
  if (profile === 'high-risk' && review.review_scope !== 'integration') {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'High-risk work requires final independent integration review'
    };
  }
  return {
    approved: true,
    state: COMPLETION_STATES.SEMANTIC_REVIEW_APPROVED,
    reviewId: review.id
  };
}
