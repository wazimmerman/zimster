export function parseReleaseEvidenceTagPayload(contents) {
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
