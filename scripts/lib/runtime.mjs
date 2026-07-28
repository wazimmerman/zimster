import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
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

async function readJsonLines(file) {
  try {
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function migrateLegacyJsonlStore(repoRoot, runtimeDirectory, segment, fileName) {
  const legacyDirectory = path.join(repoRoot, '.zimster', segment);
  const targetDirectory = path.join(runtimeDirectory, segment);
  const legacyFile = path.join(legacyDirectory, fileName);
  let legacy;
  try {
    legacy = await readJsonLines(legacyFile);
  } catch (error) {
    throw new Error(`cannot migrate legacy ${segment} records: ${error.message}`);
  }
  if (legacy === null) return targetDirectory;

  await mkdir(targetDirectory, { recursive: true });
  const targetFile = path.join(targetDirectory, fileName);
  const current = await readJsonLines(targetFile) || [];
  const merged = [];
  const seen = new Set();
  for (const row of [...current, ...legacy]) {
    const identity = row.id ? `id:${row.id}` : `row:${JSON.stringify(row)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(row);
  }
  const temporary = `${targetFile}.migration-${process.pid}`;
  await writeFile(temporary, merged.map((row) => JSON.stringify(row)).join('\n') + (merged.length ? '\n' : ''));
  await rename(temporary, targetFile);
  await rm(legacyFile, { force: true });
  if ((await readdir(legacyDirectory)).length === 0) await rmdir(legacyDirectory);
  const legacyRoot = path.dirname(legacyDirectory);
  try {
    if ((await readdir(legacyRoot)).length === 0) await rmdir(legacyRoot);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return targetDirectory;
}

export function resolveAuditPath(repoRoot, requestedPath) {
  const target = path.resolve(repoRoot, requestedPath);
  const relative = path.relative(repoRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--audit-path must be a project-relative file path inside the repository');
  }
  return target;
}
