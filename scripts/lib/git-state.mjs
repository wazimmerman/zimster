import { createHash } from 'node:crypto';
import { readFile, lstat, readlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function runGit(args, cwd = process.cwd(), { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, { cwd, encoding, maxBuffer: 128 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

export function findRepoRoot(cwd = process.cwd()) {
  return String(runGit(['rev-parse', '--show-toplevel'], cwd).stdout).trim();
}

export function gitValue(args, cwd = process.cwd(), fallback = null) {
  const result = runGit(args, cwd, { allowFailure: true });
  return result.status === 0 ? String(result.stdout).trim() : fallback;
}

export function untrackedFiles(cwd = process.cwd()) {
  const output = runGit(['ls-files', '--others', '--exclude-standard', '-z'], cwd, { encoding: 'buffer' }).stdout;
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

async function hashPath(absolute) {
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) {
    return `symlink:${await readlink(absolute)}`;
  }
  if (!metadata.isFile()) return `other:${metadata.mode}:${metadata.size}`;
  const data = await readFile(absolute);
  return `file:${metadata.mode}:${metadata.size}:${createHash('sha256').update(data).digest('hex')}`;
}

export async function captureGitState(cwd = process.cwd()) {
  const root = findRepoRoot(cwd);
  const head = gitValue(['rev-parse', 'HEAD'], root, null);
  const tree = gitValue(['rev-parse', 'HEAD^{tree}'], root, null);
  const branch = gitValue(['branch', '--show-current'], root, '');
  const status = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root, { encoding: 'buffer' }).stdout;
  const unstaged = runGit(['diff', '--binary', '--no-ext-diff', '--no-color'], root, { encoding: 'buffer' }).stdout;
  const staged = runGit(['diff', '--cached', '--binary', '--no-ext-diff', '--no-color'], root, { encoding: 'buffer' }).stdout;
  const untracked = [];
  for (const relative of untrackedFiles(root)) {
    untracked.push([relative, await hashPath(path.join(root, ...relative.split('/')))]);
  }

  const hash = createHash('sha256');
  hash.update(`head\0${head ?? ''}\0tree\0${tree ?? ''}\0branch\0${branch}\0`);
  hash.update(status);
  hash.update(unstaged);
  hash.update(staged);
  for (const [relative, digest] of untracked) hash.update(`untracked\0${relative}\0${digest}\0`);

  const dirtyHash = createHash('sha256');
  dirtyHash.update(status);
  dirtyHash.update(unstaged);
  dirtyHash.update(staged);
  for (const [relative, digest] of untracked) dirtyHash.update(`untracked\0${relative}\0${digest}\0`);

  return {
    root,
    head,
    tree,
    branch,
    status: status.toString('utf8'),
    working_tree_hash: hash.digest('hex'),
    dirty_tree_fingerprint: dirtyHash.digest('hex'),
    untracked: untracked.map(([file, digest]) => ({ file, digest }))
  };
}
