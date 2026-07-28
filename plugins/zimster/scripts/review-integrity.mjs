import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot, gitValue, runGit } from './lib/git-state.mjs';
import {
  canonicalPath,
  pathFromIdentity,
  reviewFileIdentity
} from './lib/path-identity.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = await canonicalPath(findRepoRoot(process.cwd()));
const repositoryIdentity = pathToFileURL(root).href;
const shaPattern = /^[0-9a-f]{40}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function immutableCommit(option) {
  const value = required(options, option).toLowerCase();
  if (!shaPattern.test(value)) throw new Error(`--${option} must be an immutable 40-character SHA`);
  const result = runGit(['cat-file', '-e', `${value}^{commit}`], root, { allowFailure: true });
  if (result.status !== 0) throw new Error(`--${option} is not a commit in this repository: ${value}`);
  return value;
}

async function pathDigest(identity) {
  const absolute = pathFromIdentity(root, identity);
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) return `symlink:${await readlink(absolute)}`;
    if (!metadata.isFile()) return `other:${metadata.mode}:${metadata.size}`;
    return `file:${metadata.mode}:${metadata.size}:${sha256(await readFile(absolute))}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function explicitReviewFiles(requested = null) {
  const supplied = requested || String(options['review-files'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const files = requested
    ? [...supplied].sort()
    : (await Promise.all(supplied.map((file) => reviewFileIdentity(root, file)))).sort();
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await pathDigest(file)])));
}

async function checkoutState(reviewFiles = null) {
  const state = await captureGitState(root);
  const staged = runGit(['diff', '--cached', '--binary', '--no-ext-diff', '--no-color'], root, { encoding: 'buffer' }).stdout;
  const unstaged = runGit(['diff', '--binary', '--no-ext-diff', '--no-color'], root, { encoding: 'buffer' }).stdout;
  const indexFiles = {};
  const indexEntries = String(runGit(['ls-files', '--stage', '-z'], root).stdout).split('\0').filter(Boolean);
  for (const entry of indexEntries) {
    const tab = entry.indexOf('\t');
    if (tab !== -1) indexFiles[entry.slice(tab + 1)] = entry.slice(0, tab);
  }
  const workingFiles = {};
  for (const file of Object.keys(indexFiles).sort()) workingFiles[file] = await pathDigest(file);
  return {
    head: state.head,
    head_tree: state.tree,
    index_tree: gitValue(['write-tree'], root, null),
    working_tree_hash: state.working_tree_hash,
    staged_hash: sha256(staged),
    unstaged_hash: sha256(unstaged),
    index_files: indexFiles,
    working_files: workingFiles,
    untracked: Object.fromEntries(state.untracked.map(({ file, digest }) => [file, digest])),
    status: String(runGit(['status', '--short', '--untracked-files=all'], root).stdout),
    review_files: await explicitReviewFiles(reviewFiles)
  };
}

function changedKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .sort();
}

async function capture() {
  const baseSha = immutableCommit('base');
  const headSha = immutableCommit('head');
  const currentHead = gitValue(['rev-parse', 'HEAD'], root, null);
  if (currentHead !== headSha) throw new Error(`--head must equal the owner checkout HEAD at capture time (${currentHead})`);
  const runtime = await ensureRuntimeDirectory(root);
  const output = options.output
    ? path.resolve(root, String(options.output))
    : path.join(runtime, 'review-integrity.json');
  const payload = {
    schema_version: 1,
    repository: repositoryIdentity,
    git_dir: pathToFileURL(await canonicalPath(
      gitValue(['rev-parse', '--path-format=absolute', '--absolute-git-dir'], root, null)
    )).href,
    base_sha: baseSha,
    head_sha: headSha,
    captured_at: new Date().toISOString(),
    state: await checkoutState()
  };
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  writeLine(output);
}

async function verify() {
  const receiptPath = path.resolve(required(options, 'receipt'));
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (receipt.repository !== repositoryIdentity) {
    throw new Error('review-integrity receipt belongs to a different repository/worktree');
  }
  const before = receipt.state;
  const current = await checkoutState(Object.keys(before.review_files || {}));
  const violations = [];
  if (before.head !== current.head) violations.push(`HEAD: ${before.head} -> ${current.head}`);
  if (before.index_tree !== current.index_tree || before.staged_hash !== current.staged_hash) {
    const names = changedKeys(before.index_files || {}, current.index_files || {});
    violations.push(`index/staged files: ${names.join(', ') || '(index tree changed)'}`);
  }
  if (before.unstaged_hash !== current.unstaged_hash) {
    const names = changedKeys(before.working_files || {}, current.working_files || {});
    violations.push(`tracked working-tree files: ${names.join(', ') || '(tracked content changed)'}`);
  }
  const untracked = changedKeys(before.untracked || {}, current.untracked || {});
  if (untracked.length) violations.push(`untracked files: ${untracked.join(', ')}`);
  const reviewFiles = changedKeys(before.review_files || {}, current.review_files || {});
  if (reviewFiles.length) violations.push(`review-package files: ${reviewFiles.join(', ')}`);
  if (before.working_tree_hash !== current.working_tree_hash && !violations.length) {
    violations.push('working-tree fingerprint changed');
  }
  if (violations.length) {
    writeError('TREE_INTEGRITY_VIOLATION');
    for (const violation of violations) writeError(`- ${violation}`);
    process.exitCode = 2;
    return;
  }
  writeLine('TREE_INTEGRITY_OK');
}

if (action === 'capture') await capture();
else if (action === 'verify') await verify();
else throw new Error('Usage: review-integrity.mjs <capture|verify>');
