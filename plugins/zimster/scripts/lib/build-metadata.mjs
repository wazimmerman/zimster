import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { captureGitState, gitValue } from './git-state.mjs';

export async function buildMetadata(sourceRoot, packageTarget) {
  let embedded = null;
  try {
    embedded = JSON.parse(await readFile(
      path.join(sourceRoot, 'skills', 'using-zimster', 'references', 'build-metadata.json'),
      'utf8'
    ));
  } catch {
    // Source trees can bootstrap metadata from package.json alone.
  }
  let version;
  try {
    ({ version } = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')));
  } catch {
    version = embedded?.semantic_version;
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error('cannot determine a semantic Zimster version from package.json or embedded build metadata');
  }
  let sourceState = null;
  try { sourceState = await captureGitState(sourceRoot); } catch {}
  let sourceCommit = sourceState?.head || gitValue(['rev-parse', 'HEAD'], sourceRoot, null);
  let sourceTree = sourceState?.tree || null;
  let sourceDirtyTreeFingerprint = sourceState?.dirty_tree_fingerprint || null;
  let commitDate = gitValue(['show', '-s', '--format=%cI', 'HEAD'], sourceRoot, null);
  if ((!sourceCommit || !sourceTree || !sourceDirtyTreeFingerprint || !commitDate) && embedded) {
    const validCommit = /^[0-9a-f]{40}$/.test(String(embedded.source_commit || ''));
    const validTree = /^[0-9a-f]{40}$/.test(String(embedded.source_tree || ''));
    const validDirty = /^[0-9a-f]{64}$/.test(String(embedded.source_dirty_tree_fingerprint || ''));
    const validDate = !Number.isNaN(Date.parse(String(embedded.build_date || '')));
    if (
      embedded.schema_version === 1
      && embedded.semantic_version === version
      && validCommit
      && validTree
      && validDirty
      && validDate
    ) {
      sourceCommit ||= embedded.source_commit;
      sourceTree ||= embedded.source_tree;
      sourceDirtyTreeFingerprint ||= embedded.source_dirty_tree_fingerprint;
      commitDate ||= embedded.build_date;
    }
  }
  const identity = sourceCommit || 'unversioned';
  return {
    schema_version: 1,
    semantic_version: version,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    source_dirty_tree_fingerprint: sourceDirtyTreeFingerprint,
    build_date: commitDate,
    build_id: `zimster-${version}-${identity.slice(0, 12)}-${packageTarget}`,
    package_target: packageTarget
  };
}
