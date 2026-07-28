import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gitValue } from './git-state.mjs';

export async function ensureRuntimeDirectory(repoRoot) {
  const absolute = gitValue(
    ['rev-parse', '--path-format=absolute', '--git-path', 'zimster'],
    repoRoot,
    null
  );
  const fallback = gitValue(['rev-parse', '--git-path', 'zimster'], repoRoot, null);
  if (!absolute && !fallback) throw new Error('unable to resolve Git-local Zimster runtime path');
  const directory = absolute || path.resolve(repoRoot, fallback);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function resolveAuditPath(repoRoot, requestedPath) {
  const target = path.resolve(repoRoot, requestedPath);
  const relative = path.relative(repoRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--audit-path must be a project-relative file path inside the repository');
  }
  return target;
}
