import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gitValue } from './git-state.mjs';

export async function buildMetadata(sourceRoot, packageTarget) {
  const { version } = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const sourceCommit = gitValue(['rev-parse', 'HEAD'], sourceRoot, null);
  const commitDate = gitValue(['show', '-s', '--format=%cI', 'HEAD'], sourceRoot, null);
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
