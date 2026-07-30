const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CLEAN_DIRTY_TREE_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REQUIREMENT_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]{3,}$/;
const REQUIREMENT_STATES = Object.freeze([
  'verified',
  'partially_verified',
  'unverified',
  'blocked_by_environment',
  'blocked_by_requirement',
  'not_applicable'
]);

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
  if (!SHA256_PATTERN.test(record.requirement_matrix_sha256 || '')) {
    throw new Error('review record requires requirement_matrix_sha256');
  }
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
  candidateBase,
  candidateHead,
  reviewPackageId,
  requirementMatrixSha256,
  requiredLenses = [],
  reviews,
  bindingRequirementIds = [],
  intendedClaims = []
}) {
  if (!['standard', 'high-risk'].includes(profile)) {
    throw new Error('independentApprovalFor requires standard or high-risk profile');
  }
  if (!SHA_PATTERN.test(candidateBase || '')) {
    throw new Error('independentApprovalFor requires an immutable candidate base');
  }
  if (!reviewPackageId || !SHA256_PATTERN.test(requirementMatrixSha256 || '')) {
    throw new Error('independentApprovalFor requires the current package and matrix identity');
  }
  if (!Array.isArray(requiredLenses) || !requiredLenses.length) {
    throw new Error('independentApprovalFor requires semantic lenses from the review package');
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
  const exactBaseReviews = exactHeadReviews.filter(
    (record) => record.base_sha === candidateBase
  );
  if (!exactBaseReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the candidate base'
    };
  }
  const exactPackageReviews = exactBaseReviews.filter(
    (record) => record.review_package_id === reviewPackageId
  );
  if (!exactPackageReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the current review package'
    };
  }
  const exactMatrixReviews = exactPackageReviews.filter(
    (record) => record.requirement_matrix_sha256 === requirementMatrixSha256
  );
  if (!exactMatrixReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the current requirement matrix'
    };
  }
  const review = exactMatrixReviews.at(-1);
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
  const missingLenses = requiredLenses.filter(
    (lens) => !review.semantic_lenses.includes(lens)
  );
  if (missingLenses.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE,
      reason: `independent review did not apply required semantic lenses: ${missingLenses.join(', ')}`
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

function uniqueIds(records, label, issues) {
  const seen = new Set();
  for (const record of records) {
    if (!REQUIREMENT_ID_PATTERN.test(record?.id || '')) {
      issues.push(`${label} has malformed requirement ID ${record?.id || '(missing)'}`);
      continue;
    }
    if (seen.has(record.id)) issues.push(`${label} repeats requirement ID ${record.id}`);
    seen.add(record.id);
  }
  return seen;
}

function evidenceIssue(entry, item, matrix) {
  if (!item) return 'referenced evidence is missing';
  if (item.status !== 'valid') return `evidence ${item.id} is ${item.status || 'not valid'}`;
  if (!item.requirement_ids?.includes(entry.id)) {
    return `evidence ${item.id} does not support requirement ${entry.id}`;
  }
  if (entry.evidence_scope?.git_tree === 'candidate' && (
    item.git_commit !== matrix.candidate_head || item.git_tree !== matrix.candidate_tree
  )) {
    return `evidence ${item.id} does not apply to the candidate Git tree`;
  }
  if (
    entry.evidence_scope?.git_tree === 'candidate'
    && item.dirty_tree_fingerprint !== CLEAN_DIRTY_TREE_FINGERPRINT
  ) {
    return `evidence ${item.id} came from a dirty checkout, not the committed candidate tree`;
  }
  const expectedEnvironment = entry.evidence_scope?.environment;
  if (expectedEnvironment && item.environment_scope !== expectedEnvironment) {
    return `evidence ${item.id} environment scope ${item.environment_scope || '(missing)'} does not match ${expectedEnvironment}`;
  }
  return null;
}

export function evaluateRequirementMatrix({
  bindingRequirements,
  matrix,
  evidence = []
}) {
  const issues = [];
  const unverified = [];
  const allowedClaims = new Set();
  const validEvidenceIds = new Set();
  const counts = Object.fromEntries(REQUIREMENT_STATES.map((state) => [state, 0]));
  if (!matrix || matrix.schema_version !== 1) issues.push('matrix schema_version must be 1');
  if (!SHA_PATTERN.test(matrix?.candidate_head || '')) {
    issues.push('matrix candidate_head must be an immutable 40-character SHA');
  }
  if (!SHA_PATTERN.test(matrix?.candidate_tree || '')) {
    issues.push('matrix candidate_tree must be a 40-character Git tree');
  }
  const bindings = Array.isArray(bindingRequirements) ? bindingRequirements : [];
  const entries = Array.isArray(matrix?.requirements) ? matrix.requirements : [];
  const bindingIds = uniqueIds(bindings, 'binding requirement set', issues);
  const entryIds = uniqueIds(entries, 'requirement matrix', issues);
  for (const id of bindingIds) {
    if (!entryIds.has(id)) issues.push(`${id} is missing from the requirement matrix`);
  }
  for (const id of entryIds) {
    if (!bindingIds.has(id)) issues.push(`${id} is not present in the binding requirement set`);
  }
  const evidenceRecords = [
    ...evidence,
    ...(Array.isArray(matrix?.observations) ? matrix.observations : [])
  ];
  const evidenceById = new Map();
  for (const item of evidenceRecords) {
    if (!item?.id) {
      issues.push('evidence record requires an ID');
      continue;
    }
    if (evidenceById.has(item.id)) issues.push(`duplicate evidence ID ${item.id}`);
    evidenceById.set(item.id, item);
  }
  const bindingById = new Map(bindings.map((item) => [item.id, item]));
  for (const entry of entries) {
    if (!REQUIREMENT_STATES.includes(entry.status)) {
      issues.push(`${entry.id}: unsupported requirement status ${entry.status}`);
      continue;
    }
    counts[entry.status] += 1;
    const binding = bindingById.get(entry.id);
    if (binding && entry.authoritative_text !== binding.text) {
      issues.push(`${entry.id}: authoritative text differs from the binding requirement`);
    }
    if (typeof entry.source !== 'string' || !entry.source.trim()) {
      issues.push(`${entry.id}: source plan or mission location is required`);
    }
    if (!Array.isArray(entry.implementation_locations) || !entry.implementation_locations.length) {
      issues.push(`${entry.id}: implementation locations are required`);
    }
    if (!Array.isArray(entry.unavailable_proof)) {
      issues.push(`${entry.id}: unavailable_proof must be an array`);
    }
    if (!Array.isArray(entry.intended_acceptance_claims)) {
      issues.push(`${entry.id}: intended_acceptance_claims must be an array`);
    }
    const references = Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [];
    const usableEvidence = [];
    for (const reference of references) {
      const item = evidenceById.get(reference);
      const issue = evidenceIssue(entry, item, matrix);
      if (issue) {
        issues.push(`${entry.id}: ${issue}`);
        unverified.push(`${entry.id}: ${issue}`);
      } else {
        usableEvidence.push(item);
        validEvidenceIds.add(item.id);
      }
    }
    if (entry.status === 'verified') {
      if (!references.length) {
        issues.push(`${entry.id}: verified requirement has no evidence`);
        unverified.push(`${entry.id}: verified requirement has no evidence`);
      }
      if (entry.unavailable_proof?.length) {
        issues.push(`${entry.id}: verified requirement declares unavailable proof`);
        unverified.push(`${entry.id}: proof is explicitly unavailable`);
      }
      for (const claim of entry.intended_acceptance_claims || []) {
        const explicitlyExcluded = usableEvidence.some(
          (item) => item.does_not_establish?.includes(claim)
        );
        const established = usableEvidence.some(
          (item) => item.establishes?.includes(claim)
        );
        if (explicitlyExcluded || !established) {
          const reason = explicitlyExcluded
            ? `evidence explicitly does not establish the broader claim "${claim}"`
            : `evidence scope does not establish claim "${claim}"`;
          issues.push(`${entry.id}: ${reason}`);
          unverified.push(`${entry.id}: ${reason}`);
        } else {
          allowedClaims.add(claim);
        }
      }
    } else if (entry.status === 'not_applicable') {
      if (typeof entry.not_applicable_reason !== 'string' || !entry.not_applicable_reason.trim()) {
        issues.push(`${entry.id}: not_applicable status requires a reason`);
        unverified.push(`${entry.id}: not_applicable status is unjustified`);
      }
      if (!references.length || !usableEvidence.length) {
        issues.push(`${entry.id}: not_applicable status requires scoped evidence`);
        unverified.push(`${entry.id}: not_applicable status lacks usable evidence`);
      }
    } else {
      const reason = entry.unavailable_proof?.join('; ') || `status is ${entry.status}`;
      unverified.push(`${entry.id}: ${reason}`);
    }
  }
  return {
    valid: issues.length === 0 && unverified.length === 0,
    binding_requirement_ids: [...bindingIds].sort(),
    valid_evidence_ids: [...validEvidenceIds].sort(),
    counts,
    allowed_claims: [...allowedClaims].sort(),
    unverified_obligations: [...new Set(unverified)].sort(),
    issues: [...new Set(issues)].sort()
  };
}

function proofRefsAreValid(references, matrixResult) {
  const valid = new Set(matrixResult?.valid_evidence_ids || []);
  return Array.isArray(references)
    && references.length > 0
    && references.every((reference) => valid.has(reference));
}

function validMicroEligibility(record, candidateHead, candidateTree, matrixResult) {
  const dimensions = [
    'blast_radius',
    'concurrency',
    'security_data',
    'boundary',
    'novelty',
    'observability'
  ];
  return record?.schema_version === 1
    && record.candidate_head === candidateHead
    && record.candidate_tree === candidateTree
    && record.coherent_slice === true
    && record.public_contract === false
    && Array.isArray(record.hard_triggers)
    && record.hard_triggers.length === 0
    && dimensions.every((dimension) => record.dimensions?.[dimension] === 'low')
    && proofRefsAreValid(record.deterministic_proof_refs, matrixResult);
}

function validLoadBearingObligations(record, candidateHead, candidateTree, matrixResult) {
  return record?.schema_version === 1
    && record.candidate_head === candidateHead
    && record.candidate_tree === candidateTree
    && Array.isArray(record.obligations)
    && record.obligations.length > 0
    && record.obligations.every((obligation) =>
      typeof obligation?.id === 'string'
      && obligation.id.trim()
      && obligation.status === 'satisfied'
      && proofRefsAreValid(obligation.evidence_refs, matrixResult)
    );
}

export function evaluateCandidateCompletion({
  profile,
  microEligibility = null,
  ownerVerified = false,
  reviewUnavailable = false,
  matrixResult,
  reviews = [],
  candidateBase,
  candidateHead,
  candidateTree,
  reviewPackageId,
  requirementMatrixSha256,
  requiredLenses = [],
  loadBearingReviewObligations = null,
  correctionPending = false
}) {
  if (!['micro', 'standard', 'high-risk'].includes(profile)) {
    throw new Error('profile must be micro, standard, or high-risk');
  }
  const result = (state, {
    allowedClaims = [],
    reviewId = null,
    reasons = []
  } = {}) => ({
    state,
    allowed_claims: allowedClaims,
    review_id: reviewId,
    reasons
  });
  if (!ownerVerified) {
    return result(COMPLETION_STATES.IMPLEMENTATION_COMPLETE, {
      reasons: ['owner verification is incomplete']
    });
  }
  if (!matrixResult?.valid) {
    const reasons = [
      ...(matrixResult?.issues || []),
      ...(matrixResult?.unverified_obligations || [])
    ];
    return result(
      reviewUnavailable
        ? COMPLETION_STATES.PARTIALLY_VERIFIED
        : COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE,
      { reasons: reasons.length ? reasons : ['requirement evidence is incomplete'] }
    );
  }
  const allowedClaims = matrixResult.allowed_claims || [];
  if (profile === 'micro') {
    if (!validMicroEligibility(
      microEligibility,
      candidateHead,
      candidateTree,
      matrixResult
    )) {
      return result(COMPLETION_STATES.PARTIALLY_VERIFIED, {
        allowedClaims,
        reasons: ['Micro owner-only completion requires deterministic Micro eligibility']
      });
    }
    return result(COMPLETION_STATES.CANDIDATE_COMPLETE, { allowedClaims });
  }
  if (reviewUnavailable) {
    return result(COMPLETION_STATES.OWNER_VERIFIED_REVIEW_UNAVAILABLE, {
      allowedClaims,
      reasons: ['independent semantic review is unavailable']
    });
  }
  if (correctionPending) {
    return result(COMPLETION_STATES.REVIEW_PENDING, {
      allowedClaims,
      reasons: ['correction invalidated prior approval; bounded recheck is required']
    });
  }
  if (
    profile === 'high-risk'
    && !validLoadBearingObligations(
      loadBearingReviewObligations,
      candidateHead,
      candidateTree,
      matrixResult
    )
  ) {
    return result(COMPLETION_STATES.REVIEW_PENDING, {
      allowedClaims,
      reasons: ['High-risk load-bearing review obligations are incomplete']
    });
  }
  const approval = independentApprovalFor({
    profile,
    candidateBase,
    candidateHead,
    reviewPackageId,
    requirementMatrixSha256,
    requiredLenses,
    reviews,
    bindingRequirementIds: matrixResult.binding_requirement_ids || [],
    intendedClaims: allowedClaims
  });
  if (!approval.approved) {
    return result(approval.state, {
      allowedClaims,
      reasons: [approval.reason]
    });
  }
  return result(COMPLETION_STATES.CANDIDATE_COMPLETE, {
    allowedClaims,
    reviewId: approval.reviewId
  });
}

export function selectSemanticLenses(signals = []) {
  const requested = new Set(signals);
  const frameworkSignals = [
    'build-tool',
    'wrapper-adapter',
    'configuration-loader',
    'cli-framework',
    'router',
    'orm',
    'plugin-system',
    'inherited-project-configuration',
    'generated-user-managed-topology',
    'convention-heavy-framework'
  ];
  const sharedControlFlowSignals = [
    'shared-adapter-control-flow',
    'shared-provider-control-flow',
    'shared-platform-control-flow',
    'shared-backend-control-flow',
    'common-specialized-branching'
  ];
  const lenses = [];
  if (frameworkSignals.some((signal) => requested.has(signal))) {
    lenses.push('framework-defaults-and-conventions');
  }
  if (sharedControlFlowSignals.some((signal) => requested.has(signal))) {
    lenses.push('shared-control-flow');
  }
  return lenses;
}
