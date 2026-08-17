import { createHash } from 'node:crypto';
import {
  REVIEW_ATTEMPT_TYPES,
  validateAssuranceAccounting,
  validateReviewLifecycle
} from './review-lifecycle.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CLEAN_DIRTY_TREE_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REQUIREMENT_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]{3,}$/;
const REQUIREMENT_STATES = Object.freeze([
  'pending',
  'verified',
  'partially_verified',
  'unverified',
  'blocked_by_environment',
  'blocked_by_requirement',
  'not_applicable'
]);
const PUBLIC_BETA_HOST_IDS = Object.freeze(['codex', 'claude', 'grok', 'kimi', 'opencode', 'pi']);
const PUBLIC_BETA_CANDIDATE = Object.freeze({
  codex: 'codex',
  claude: 'claude',
  grok: 'portable',
  kimi: 'npm',
  opencode: 'npm',
  pi: 'npm'
});
const HOST_VERIFICATION_STATES = Object.freeze([
  'LIVE_VERIFIED',
  'INSTALLED_PACKAGE_VERIFIED',
  'STRUCTURALLY_VALIDATED',
  'BLOCKED_BY_AUTHENTICATION',
  'UNAVAILABLE',
  'UNSUPPORTED'
]);
const RELEASE_HOST_POLICIES = Object.freeze({
  public_beta: Object.freeze({ minimum_live_verified_hosts: 1, required_live_host_ids: Object.freeze([]) }),
  stable: Object.freeze({
    minimum_live_verified_hosts: PUBLIC_BETA_HOST_IDS.length,
    required_live_host_ids: PUBLIC_BETA_HOST_IDS
  })
});
const REVIEW_FINDING_SEVERITIES = Object.freeze(['Critical', 'Important', 'Minor']);
const REVIEW_FINDING_FIELDS = Object.freeze(['severity', 'summary', 'count']);

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
  BLOCKED_BY_MISSING_EVIDENCE: 'BLOCKED_BY_MISSING_EVIDENCE',
  BLOCKED_BY_ENVIRONMENT: 'BLOCKED_BY_ENVIRONMENT'
});

export function validateHostSmokeReceipt(receipt, {
  candidateHead,
  candidateTree,
  releaseChannel = 'public_beta'
}) {
  if (!receipt || receipt.schema_version !== 3 || receipt.status !== 'passed') {
    throw new Error('host verification receipt must be schema v3 and passed');
  }
  if (!['public_beta', 'stable'].includes(releaseChannel) || receipt.release_channel !== releaseChannel) {
    throw new Error('host verification receipt does not match the requested release channel');
  }
  if (receipt.candidate_head !== candidateHead || receipt.candidate_tree !== candidateTree) {
    throw new Error('host smoke receipt does not match the candidate head and tree');
  }
  if (receipt.dirty_tree_fingerprint !== CLEAN_DIRTY_TREE_FINGERPRINT) {
    throw new Error('host smoke receipt was not produced from the clean candidate tree');
  }
  const publicHosts = [...new Set(receipt.public_host_ids || [])].sort();
  if (JSON.stringify(publicHosts) !== JSON.stringify([...PUBLIC_BETA_HOST_IDS].sort())) {
    throw new Error('host verification receipt must represent all six public harnesses');
  }
  if (!Array.isArray(receipt.hosts) || receipt.hosts.length !== PUBLIC_BETA_HOST_IDS.length) {
    throw new Error('host verification receipt requires one result for every public harness');
  }
  if (!receipt.artifact_digests || typeof receipt.artifact_digests !== 'object') {
    throw new Error('host smoke receipt requires exact artifact digests');
  }
  const byId = new Map(receipt.hosts.map((host) => [host.id, host]));
  for (const id of PUBLIC_BETA_HOST_IDS) {
    const host = byId.get(id);
    const candidate = PUBLIC_BETA_CANDIDATE[id];
    const digest = receipt.artifact_digests[candidate];
    if (!host || host.candidate !== candidate || !HOST_VERIFICATION_STATES.includes(host.verification_state)) {
      throw new Error(`host verification record for ${id} is missing or has an unsupported state`);
    }
    if (host.candidate_commit !== candidateHead || host.candidate_tree !== candidateTree) {
      throw new Error(`host verification record for ${id} does not match the exact candidate commit and tree`);
    }
    if (host.archive_sha256 !== undefined && (
      !SHA256_PATTERN.test(digest || '') || host.archive_sha256 !== digest
    )) {
      throw new Error(`host verification proof for ${id} does not match the exact ${candidate} artifact digest`);
    }
    for (const field of [
      'commands_or_observations', 'receipt_ids', 'capabilities_established',
      'capabilities_not_established', 'public_claims', 'known_limitations'
    ]) {
      if (!Array.isArray(host[field])) throw new Error(`host verification record for ${id} requires ${field}`);
    }
    if (typeof host.installation_available !== 'boolean' || typeof host.model_backed_execution !== 'boolean') {
      throw new Error(`host verification record for ${id} requires installation and model-backed execution facts`);
    }
    if (!host.authentication || !host.configuration) {
      throw new Error(`host verification record for ${id} requires authentication and configuration availability`);
    }
    if (
      !host.verified_at || Number.isNaN(Date.parse(host.verified_at))
      || !host.expires_at || Number.isNaN(Date.parse(host.expires_at))
      || Date.parse(host.expires_at) <= Date.parse(host.verified_at)
    ) {
      throw new Error(`host verification record for ${id} requires valid freshness information`);
    }
    if (Date.parse(host.expires_at) <= Date.now()) {
      throw new Error(`host verification record for ${id} is expired`);
    }
    const established = new Set(host.capabilities_established);
    if (host.public_claims.some((claim) => !established.has(claim))) {
      throw new Error(`public claim for ${id} is broader than its host receipt`);
    }
    if (
      host.public_claims.includes('live_host_execution')
      && host.verification_state !== 'LIVE_VERIFIED'
    ) {
      throw new Error(`live-support claim for ${id} lacks a LIVE_VERIFIED receipt`);
    }
    if (
      (host.public_claims.includes('model_backed_execution') || host.model_backed_execution)
      && host.verification_state !== 'LIVE_VERIFIED'
    ) {
      throw new Error(`${host.verification_state} for ${id} cannot imply model-backed execution`);
    }
    if (host.verification_state === 'LIVE_VERIFIED' && (
      !established.has('live_host_execution')
      || !established.has('fresh_session_discovery')
      || !host.archive_sha256
    )) {
      throw new Error(`LIVE_VERIFIED host ${id} lacks exact-package live fresh-session evidence`);
    }
    if (
      host.verification_state === 'INSTALLED_PACKAGE_VERIFIED'
      && (!established.has('package_installation') || host.model_backed_execution)
    ) {
      throw new Error(`installed-package verification for ${id} cannot imply model-backed execution`);
    }
    if (host.verification_state === 'STRUCTURALLY_VALIDATED' && host.model_backed_execution) {
      throw new Error(`structural validation for ${id} cannot imply live model-backed execution`);
    }
  }
  if (receipt.all_claims_bounded !== true) {
    throw new Error('every public harness claim must be bounded by its host receipt');
  }
  const liveIds = receipt.hosts
    .filter(({ verification_state: state }) => state === 'LIVE_VERIFIED')
    .map(({ id }) => id);
  const canonicalPolicy = RELEASE_HOST_POLICIES[releaseChannel];
  const minimumLive = receipt.policy?.minimum_live_verified_hosts;
  const requiredLive = receipt.policy?.required_live_host_ids;
  if (
    minimumLive !== canonicalPolicy.minimum_live_verified_hosts
    || !Array.isArray(requiredLive)
    || JSON.stringify([...requiredLive].sort())
      !== JSON.stringify([...canonicalPolicy.required_live_host_ids].sort())
  ) {
    throw new Error(`${releaseChannel} host policy does not match the canonical release profile`);
  }
  if (liveIds.length < minimumLive) {
    throw new Error(`${releaseChannel} requires at least ${minimumLive} LIVE_VERIFIED host receipt(s)`);
  }
  const missingRequired = requiredLive.filter((id) => !liveIds.includes(id));
  if (missingRequired.length) {
    throw new Error(`${releaseChannel} required live host coverage is missing: ${missingRequired.join(', ')}`);
  }
  if (!receipt.generated_at || Number.isNaN(Date.parse(receipt.generated_at))) {
    throw new Error('host smoke receipt requires a valid generation timestamp');
  }
  return receipt;
}

export function semanticContractDigest({ bindingRequirements, matrix }) {
  const bindings = Array.isArray(bindingRequirements) ? bindingRequirements : [];
  const requirements = Array.isArray(matrix?.requirements) ? matrix.requirements : [];
  const byId = (left, right) => String(left.id).localeCompare(String(right.id));
  const contract = {
    schema_version: 1,
    binding_requirements: bindings
      .map(({ id, text }) => ({ id, text }))
      .sort(byId),
    requirements: requirements.map((entry) => ({
      id: entry.id,
      authoritative_text: entry.authoritative_text,
      source: entry.source,
      implementation_locations: [...(entry.implementation_locations || [])].sort(),
      evidence_scope: {
        environment: entry.evidence_scope?.environment || null
      },
      intended_acceptance_claims: [
        ...(entry.intended_acceptance_claims || [])
      ].sort()
    })).sort(byId)
  };
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

function requireString(record, field) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    throw new Error(`review record requires ${field}`);
  }
}

function validateReviewFinding(finding, index) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new Error(`review finding ${index} must be an object`);
  }
  const unsupportedFields = Object.keys(finding)
    .filter((field) => !REVIEW_FINDING_FIELDS.includes(field));
  if (unsupportedFields.length) {
    throw new Error(`review finding ${index} has unsupported fields: ${unsupportedFields.join(', ')}`);
  }
  if (!REVIEW_FINDING_SEVERITIES.includes(finding.severity)) {
    throw new Error(`review finding ${index} severity must be Critical, Important, or Minor`);
  }
  if (typeof finding.summary !== 'string' || !finding.summary.trim()) {
    throw new Error(`review finding ${index} requires summary`);
  }
  if (finding.count !== undefined && (!Number.isInteger(finding.count) || finding.count < 1)) {
    throw new Error(`review finding ${index} count must be a positive integer`);
  }
  return finding;
}

export function validateReviewRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('review record must be an object');
  }
  if (![1, 2].includes(record.schema_version)) {
    throw new Error('review record schema_version must be 1 or 2');
  }
  if (!REVIEW_TYPES.includes(record.review_type)) {
    throw new Error('review_type must be self_review or independent_review');
  }
  if (record.owner_inline === true && record.review_type !== 'self_review') {
    throw new Error('owner-inline review must use self_review');
  }
  for (const field of ['id', 'review_package_id']) requireString(record, field);
  if (record.schema_version === 2) {
    for (const field of ['attempt_id', 'seam_id']) requireString(record, field);
    if (!REVIEW_ATTEMPT_TYPES.includes(record.attempt_type)) {
      throw new Error('review record has an unsupported attempt_type');
    }
    if (!SHA256_PATTERN.test(record.candidate_dirty_tree_fingerprint || '')) {
      throw new Error('review record requires candidate_dirty_tree_fingerprint');
    }
    if (record.attempt_type === 'final_integration_review' && record.review_scope !== 'integration') {
      throw new Error('final_integration_review must use integration review scope');
    }
  }
  if (!SHA256_PATTERN.test(record.requirement_matrix_sha256 || '')) {
    throw new Error('review record requires requirement_matrix_sha256');
  }
  if (!SHA256_PATTERN.test(record.semantic_contract_sha256 || '')) {
    throw new Error('review record requires semantic_contract_sha256');
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
  const validatedFindings = record.findings.map(validateReviewFinding);
  if (record.verdict === 'approved') {
    const loadBearingFindings = validatedFindings.filter(({ severity }) =>
      ['Critical', 'Important'].includes(severity)
    );
    if (loadBearingFindings.length) {
      throw new Error('approved review record contradicts its load-bearing findings');
    }
    if (record.unverified_obligations.length) {
      throw new Error('approved review record contradicts its unresolved obligations');
    }
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
  reviewAttemptId = null,
  reviewSeamId,
  semanticContractSha256,
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
  if (!reviewPackageId || !reviewSeamId || !SHA256_PATTERN.test(semanticContractSha256 || '')) {
    throw new Error('independentApprovalFor requires the review package, seam, and semantic contract identity');
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
  const exactAttemptReviews = reviewAttemptId
    ? exactPackageReviews.filter((record) =>
      record.schema_version === 2
      && record.attempt_id === reviewAttemptId
      && record.attempt_type === 'final_integration_review')
    : exactPackageReviews;
  if (!exactAttemptReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the final integration attempt'
    };
  }
  const exactSeamReviews = exactAttemptReviews.filter(
    (record) => record.seam_id === reviewSeamId
  );
  if (!exactSeamReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the selected review seam'
    };
  }
  const exactContractReviews = exactSeamReviews.filter(
    (record) => record.semantic_contract_sha256 === semanticContractSha256
  );
  if (!exactContractReviews.length) {
    return {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'independent review does not cover the current semantic contract'
    };
  }
  const review = exactContractReviews.at(-1);
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
  const evidenceTree = entry.evidence_scope?.git_tree;
  if (evidenceTree !== matrix.candidate_tree) {
    return `evidence ${item.id} does not apply to the candidate Git tree`;
  }
  if (
    item.git_commit !== matrix.candidate_head || item.git_tree !== matrix.candidate_tree
  ) {
    return `evidence ${item.id} does not apply to the candidate Git tree`;
  }
  if (item.dirty_tree_fingerprint !== CLEAN_DIRTY_TREE_FINGERPRINT) {
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
  evidence = [],
  phase = 'postpublication'
}) {
  if (!['candidate', 'postpublication'].includes(phase)) {
    throw new Error('matrix evaluation phase must be candidate or postpublication');
  }
  const issues = [];
  const unverified = [];
  const deferred = [];
  const allowedClaims = new Set();
  const validEvidenceIds = new Set();
  const evidenceSupport = new Map();
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
        evidenceSupport.set(item.id, {
          id: item.id,
          requirement_ids: [...(item.requirement_ids || [])].sort(),
          establishes: [...(item.establishes || [])].sort(),
          does_not_establish: [...(item.does_not_establish || [])].sort()
        });
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
    } else if (
      phase === 'candidate'
      && entry.proof_deferred_until === 'postpublication'
      && entry.status === 'partially_verified'
      && entry.unavailable_proof?.length
    ) {
      deferred.push(`${entry.id}: ${entry.unavailable_proof.join('; ')}`);
    } else {
      const reason = entry.unavailable_proof?.join('; ') || `status is ${entry.status}`;
      unverified.push(`${entry.id}: ${reason}`);
    }
  }
  return {
    valid: issues.length === 0 && unverified.length === 0,
    binding_requirement_ids: [...bindingIds].sort(),
    valid_evidence_ids: [...validEvidenceIds].sort(),
    evidence_support: [...evidenceSupport.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    counts,
    allowed_claims: [...allowedClaims].sort(),
    deferred_obligations: [...new Set(deferred)].sort(),
    unverified_obligations: [...new Set(unverified)].sort(),
    issues: [...new Set(issues)].sort()
  };
}

function proofRefsSupport(references, requirementId, claim, matrixResult) {
  const bindings = new Set(matrixResult?.binding_requirement_ids || []);
  const support = new Map(
    (matrixResult?.evidence_support || []).map((item) => [item.id, item])
  );
  return Array.isArray(references)
    && references.length > 0
    && typeof requirementId === 'string'
    && bindings.has(requirementId)
    && typeof claim === 'string'
    && claim.trim()
    && references.every((reference) => {
      const item = support.get(reference);
      return item
        && item.requirement_ids.includes(requirementId)
        && item.establishes.includes(claim)
        && !item.does_not_establish.includes(claim);
    });
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
    && proofRefsSupport(
      record.deterministic_proof_refs,
      record.requirement_id,
      record.claim,
      matrixResult
    );
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
      && proofRefsSupport(
        obligation.evidence_refs,
        obligation.requirement_id,
        obligation.claim,
        matrixResult
      )
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
  reviewPackageSeamId,
  semanticContractSha256,
  requiredLenses = [],
  loadBearingReviewObligations = null,
  hostSmokeReceipt = null,
  releaseChannel = 'public_beta',
  correctionPending = false,
  reviewLifecycle = null,
  reviewLifecycles = null,
  assuranceAccounting = null
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
  if ((matrixResult?.counts?.blocked_by_environment || 0) > 0) {
    return result(COMPLETION_STATES.BLOCKED_BY_ENVIRONMENT, {
      allowedClaims: matrixResult?.allowed_claims || [],
      reasons: matrixResult?.unverified_obligations?.length
        ? matrixResult.unverified_obligations
        : ['required environment proof is unavailable']
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
  if ((matrixResult.binding_requirement_ids || []).includes('BETA-003')) {
    try {
      validateHostSmokeReceipt(hostSmokeReceipt, { candidateHead, candidateTree, releaseChannel });
    } catch (error) {
      return result(COMPLETION_STATES.BLOCKED_BY_ENVIRONMENT, {
        allowedClaims,
        reasons: [`claim-scoped host verification lacks the required live host floor: ${error.message}`]
      });
    }
  }
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
  if (correctionPending && !reviewLifecycle) {
    return result(COMPLETION_STATES.REVIEW_PENDING, {
      allowedClaims,
      reasons: ['correction invalidated prior approval; bounded recheck is required']
    });
  }
  try {
    validateReviewLifecycle(reviewLifecycle, {
      candidateHead,
      candidateTree,
      requireFinalApproval: true
    });
    const activeAttempts = reviewLifecycle.attempts.filter(({ attempt_id }) =>
      !reviewLifecycle.invalidated_attempt_ids.includes(attempt_id)
    );
    const selectedFinalAttempt = activeAttempts.at(-1);
    if (!reviewPackageSeamId || reviewPackageSeamId !== reviewLifecycle.seam_id) {
      throw new Error('review package seam does not match the selected review lifecycle');
    }
    if (selectedFinalAttempt?.seam_id !== reviewLifecycle.seam_id
      || selectedFinalAttempt?.review_package_id !== reviewPackageId) {
      throw new Error('selected final approval does not bind the current review package and seam');
    }
    const accountingLifecycles = reviewLifecycles || [reviewLifecycle];
    for (const lifecycle of accountingLifecycles) validateReviewLifecycle(lifecycle);
    const accountingAttempts = accountingLifecycles.flatMap(({ attempts = [] }) => attempts);
    validateAssuranceAccounting(assuranceAccounting, {
      candidateHead,
      candidateTree,
      recordedReviewAttemptIds: accountingAttempts.map(({ attempt_id }) => attempt_id),
      recordedReviewAttemptCounts: {
        correction_rechecks: accountingAttempts.filter(({ attempt_type }) =>
          attempt_type === 'correction_recheck'
        ).length,
        final_integration_reviews: accountingAttempts.filter(({ attempt_type }) =>
          attempt_type === 'final_integration_review'
        ).length
      },
      requiredReviewerIdentities: accountingLifecycles.map(({ reviewer_identity }) => reviewer_identity)
    });
  } catch (error) {
    return result(COMPLETION_STATES.REVIEW_PENDING, {
      allowedClaims,
      reasons: [error.message]
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
    reviewAttemptId: reviewLifecycle.attempts.at(-1)?.attempt_id || null,
    reviewSeamId: reviewLifecycle.seam_id,
    semanticContractSha256,
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
