import { createHash } from 'node:crypto';
import {
  evaluateHumanReleaseReview,
  validateReleaseReviewAuthorization,
  validateReviewRecord
} from './semantic-assurance.mjs';

export const MAX_EMBEDDED_INPUT_BYTES = 1024 * 1024;
export const MAX_TOTAL_EMBEDDED_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RELEASE_TAG_PAYLOAD_BYTES = 3 * 1024 * 1024;

export const RELEASE_EVIDENCE_INPUTS = Object.freeze([
  ['semantic-review.json', 'semantic_review_sha256'],
  ['host-matrix.json', 'host_matrix_sha256'],
  ['verification.json', 'verification_sha256']
]);

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const sha256 = /^[0-9a-f]{64}$/;
const secretPatterns = [
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
  /(?:NODE_AUTH_TOKEN|NPM_TOKEN|_authToken)\s*[:=]/i
];
const localPathPatterns = [
  /(?:^|[\s"'])(?:\/home\/|\/Users\/|\/root\/|\/tmp\/|\/var\/tmp\/|\/private\/tmp\/|\/private\/var\/folders\/)/,
  /(?:^|[\s"'])[A-Za-z]:[\\/](?:Users[\\/]|Temp[\\/]|Windows[\\/]Temp[\\/])/i,
  /(?:^|[\\/])\.git[\\/]zimster(?:[\\/]|$)/i
];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const actual = Object.keys(value);
  const unsupported = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unsupported.length || missing.length) {
    throw new Error(`${label} has unexpected structure`);
  }
}

function safeStrings(value, location = '$') {
  if (typeof value === 'string') {
    if (secretPatterns.some((pattern) => pattern.test(value))) {
      throw new Error(`public release input contains a secret at ${location}`);
    }
    if (localPathPatterns.some((pattern) => pattern.test(value))) {
      throw new Error(`public release input contains an unsafe machine-local path at ${location}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => safeStrings(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) safeStrings(item, `${location}.${key}`);
  }
}

function stringArray(value, field) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
}

export function validatePublicReleaseInput(name, bytes, { candidateCommit, candidateTree }) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
  safeStrings(value);
  if (name === 'semantic-review.json') {
    exactKeys(value, [
      'schema_version', 'id', 'review_type', 'owner_inline', 'base_sha', 'head_sha',
      'candidate_tree', 'seam_id', 'review_attempt_id', 'reviewer_identity',
      'reviewer_provenance', 'dispatch_record_id', 'clean_bounded_context',
      'reviewed_requirement_ids', 'intended_claims', 'semantic_lenses',
      'review_scope', 'verdict', 'findings', 'unverified_obligations', 'reviewed_at',
      'review_package_id', 'requirement_matrix_sha256', 'semantic_contract_sha256',
      'checkout_integrity_result'
    ], name);
    validateReviewRecord(value);
  } else if (name === 'host-matrix.json') {
    exactKeys(value, ['schema_version', 'candidate_commit', 'candidate_tree', 'hosts'], name);
    if (value.schema_version !== 1 || value.candidate_commit !== candidateCommit || value.candidate_tree !== candidateTree) {
      throw new Error('host matrix does not match schema v1 and the exact candidate');
    }
    if (!Array.isArray(value.hosts) || !value.hosts.length) throw new Error('host matrix requires at least one host result');
    const names = new Set();
    for (const host of value.hosts) {
      exactKeys(host, [
        'host', 'artifact_sha256', 'host_version', 'tested_at', 'verification_level',
        'capabilities_established', 'capabilities_not_established', 'known_limitations'
      ], 'host matrix entry');
      if (typeof host.host !== 'string' || !host.host || names.has(host.host)) throw new Error('host matrix host names must be unique');
      names.add(host.host);
      if (!sha256.test(host.artifact_sha256 || '') || typeof host.host_version !== 'string' || !host.host_version) throw new Error('host matrix entry requires artifact and host version');
      if (!host.tested_at || Number.isNaN(Date.parse(host.tested_at)) || !['structural', 'installed-package', 'live', 'model-backed'].includes(host.verification_level)) throw new Error('host matrix entry requires test date and verification level');
      for (const field of ['capabilities_established', 'capabilities_not_established', 'known_limitations']) stringArray(host[field], field);
    }
  } else if (name === 'verification.json') {
    exactKeys(value, [
      'schema_version', 'candidate_commit', 'candidate_tree', 'status', 'steps',
      'release_review_authorization'
    ], name);
    if (value.schema_version !== 1 || value.candidate_commit !== candidateCommit || value.candidate_tree !== candidateTree || value.status !== 'passed') {
      throw new Error('verification record does not match schema v1, the exact candidate, and passed status');
    }
    if (!Array.isArray(value.steps) || !value.steps.length) throw new Error('verification record requires steps');
    for (const step of value.steps) {
      exactKeys(step, ['id', 'status', 'log_id', 'log_sha256'], 'verification step');
      if (typeof step.id !== 'string' || !step.id || step.status !== 'passed' || typeof step.log_id !== 'string' || !step.log_id || !sha256.test(step.log_sha256 || '')) {
        throw new Error('verification step requires a passed logical log identity and digest');
      }
    }
    validateReleaseReviewAuthorization(value.release_review_authorization);
  } else {
    throw new Error(`unsupported public release input: ${name}`);
  }
  return value;
}

export function validateEmbeddedPublicReleaseInputs(evidence) {
  const decoded = decodeEmbeddedReleaseInputs(evidence);
  const documents = new Map();
  for (const [name, bytes] of decoded) {
    documents.set(name, validatePublicReleaseInput(name, bytes, {
      candidateCommit: evidence.commit,
      candidateTree: evidence.tree
    }));
  }
  const decision = evaluateHumanReleaseReview({
    review: documents.get('semantic-review.json'),
    authorization: documents.get('verification.json').release_review_authorization,
    candidateHead: evidence.commit,
    candidateTree: evidence.tree
  });
  if (!decision.accepted) {
    throw new Error(`release review authorization rejected: ${decision.reasons.join('; ')}`);
  }
  return decoded;
}

export function decodeEmbeddedReleaseInputs(evidence) {
  if (evidence?.schema_version !== 2) {
    throw new Error('embedded release inputs require release-evidence schema_version 2');
  }
  const embedded = evidence.embedded_inputs;
  const expectedNames = RELEASE_EVIDENCE_INPUTS.map(([name]) => name);
  if (!embedded || Array.isArray(embedded) || typeof embedded !== 'object') {
    throw new Error('embedded input inventory must contain exactly the three supported files');
  }
  const actualNames = Object.keys(embedded);
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name) => !expectedNames.includes(name))
  ) {
    throw new Error('embedded input inventory must contain exactly the three supported files');
  }

  const decoded = new Map();
  let totalBytes = 0;
  for (const [name, digestField] of RELEASE_EVIDENCE_INPUTS) {
    const encoded = embedded[name];
    if (typeof encoded !== 'string' || !canonicalBase64.test(encoded)) {
      throw new Error(`${name} must use canonical padded Base64 encoding`);
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
      throw new Error(`${name} must use canonical padded Base64 encoding`);
    }
    if (bytes.length > MAX_EMBEDDED_INPUT_BYTES) {
      throw new Error(`${name} exceeds the embedded input size limit`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_EMBEDDED_INPUT_BYTES) {
      throw new Error('embedded inputs exceed the aggregate size limit');
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== evidence[digestField]) {
      throw new Error(`${name} bytes do not match ${digestField}`);
    }
    decoded.set(name, bytes);
  }
  return decoded;
}

export function parseReleaseEvidenceTagPayload(contents) {
  if (Buffer.byteLength(String(contents), 'utf8') > MAX_RELEASE_TAG_PAYLOAD_BYTES) {
    throw new Error('signed release tag payload exceeds the hard size limit');
  }
  let evidence;
  try {
    evidence = JSON.parse(contents);
  } catch {
    throw new Error('signed tag message must be exactly one canonical release-evidence JSON payload');
  }
  if (contents !== `${JSON.stringify(evidence, null, 2)}\n`) {
    throw new Error('signed tag message must be exactly one canonical release-evidence JSON payload');
  }
  return evidence;
}

export function parseReleaseEvidenceRefContents(contents) {
  if (!String(contents).endsWith('\n')) {
    throw new Error('signed tag reference contents must include the Git record terminator');
  }
  return parseReleaseEvidenceTagPayload(String(contents).slice(0, -1));
}

export function normalizeReleaseSignerFingerprint(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s:]/g, '');
  if (!/^(?:[0-9A-F]{40}|[0-9A-F]{64})$/.test(normalized)) {
    throw new Error('release signer fingerprint must be 40 or 64 hexadecimal characters');
  }
  return normalized;
}

export function githubReleaseState(evidence) {
  if (
    !evidence
    || !/^\d+\.\d+\.\d+$/.test(String(evidence.version || ''))
    || evidence.tag !== `v${evidence.version}`
  ) {
    throw new Error('GitHub release state requires matching strict-semver version and tag');
  }
  if (evidence.channel === 'public_beta') {
    return {
      channel: 'public_beta',
      title: `Zimster ${evidence.version} - Public Beta`,
      prerelease: true,
      latest: false
    };
  }
  if (evidence.channel === 'stable') {
    return {
      channel: 'stable',
      title: `Zimster ${evidence.version}`,
      prerelease: false,
      latest: true
    };
  }
  throw new Error('GitHub release state requires public_beta or stable channel');
}
