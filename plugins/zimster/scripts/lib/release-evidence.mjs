import { createHash } from 'node:crypto';

export const MAX_EMBEDDED_INPUT_BYTES = 1024 * 1024;
export const MAX_TOTAL_EMBEDDED_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RELEASE_TAG_PAYLOAD_BYTES = 3 * 1024 * 1024;

export const RELEASE_EVIDENCE_INPUTS = Object.freeze([
  ['semantic-review.json', 'semantic_review_sha256'],
  ['host-matrix.json', 'host_matrix_sha256'],
  ['verification.json', 'verification_sha256']
]);

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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
