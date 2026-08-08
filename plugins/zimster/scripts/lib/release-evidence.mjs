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
