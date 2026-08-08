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
