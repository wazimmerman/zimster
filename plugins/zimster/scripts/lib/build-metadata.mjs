import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gitValue } from './git-state.mjs';

export async function buildMetadata(sourceRoot, packageTarget) {
  const { version } = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  let sourceCommit = gitValue(['rev-parse', 'HEAD'], sourceRoot, null);
  let commitDate = gitValue(['show', '-s', '--format=%cI', 'HEAD'], sourceRoot, null);
  if (!sourceCommit || !commitDate) {
    try {
      const embedded = JSON.parse(await readFile(
        path.join(sourceRoot, 'skills', 'using-zimster', 'references', 'build-metadata.json'),
        'utf8'
      ));
      const validCommit = /^[0-9a-f]{40}$/.test(String(embedded.source_commit || ''));
      const validDate = !Number.isNaN(Date.parse(String(embedded.build_date || '')));
      if (embedded.schema_version === 1 && embedded.semantic_version === version && validCommit && validDate) {
        sourceCommit ||= embedded.source_commit;
        commitDate ||= embedded.build_date;
      }
    } catch {
      // A source checkout is allowed to begin without embedded release provenance.
    }
  }
  const identity = sourceCommit || 'unversioned';
  return {
    schema_version: 1,
    semantic_version: version,
    source_commit: sourceCommit,
    build_date: commitDate,
    build_id: `zimster-${version}-${identity.slice(0, 12)}-${packageTarget}`,
    package_target: packageTarget
  };
}
