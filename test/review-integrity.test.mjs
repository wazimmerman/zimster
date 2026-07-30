import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists, json, root } from './helpers.mjs';

function run(command, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(command, args, { cwd, encoding: 'utf8', env });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-integrity-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

test('repository exposes the review-integrity helper', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.scripts['review:integrity'], 'node scripts/review-integrity.mjs');
  assert.equal(await exists('scripts/review-integrity.mjs'), true);
});

test('review integrity accepts an unchanged checkout and immutable range', async () => {
  const repo = await tempRepo();
  try {
    const script = path.join(root, 'scripts/review-integrity.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    let result = run(process.execPath, [
      script, 'capture', '--base', head, '--head', head,
      '--review-files', 'tracked.txt'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = result.stdout.trim();
    const payload = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(payload.base_sha, head);
    assert.equal(payload.head_sha, head);
    assert.ok(payload.state.review_files['tracked.txt']);

    result = run(process.execPath, [script, 'verify', '--receipt', receipt], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /REVIEW_CHECKOUT_UNCHANGED/);
    assert.doesNotMatch(result.stdout, /APPROVED|SEMANTIC/i);

    result = run(process.execPath, [script, 'capture', '--base', 'main', '--head', head], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /immutable|40-character SHA/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('review integrity protects explicit review files outside the worktree', async () => {
  const repo = await tempRepo();
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-external-'));
  const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-alias-'));
  const external = path.join(externalRoot, 'mission file.md');
  const aliasDirectory = path.join(aliasRoot, 'external');
  try {
    await writeFile(external, '# Mission\n');
    await symlink(
      externalRoot,
      aliasDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const requested = path.join(aliasDirectory, path.basename(external));
    const canonicalKey = pathToFileURL(await realpath(external)).href;
    const script = path.join(root, 'scripts/review-integrity.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    let result = run(process.execPath, [
      script, 'capture', '--base', head, '--head', head, '--review-files', requested
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = result.stdout.trim();
    const payload = JSON.parse(await readFile(receipt, 'utf8'));
    assert.deepEqual(Object.keys(payload.state.review_files), [canonicalKey]);

    await writeFile(external, '# Mutated mission\n');
    result = run(process.execPath, [script, 'verify', '--receipt', receipt], repo);
    assert.notEqual(result.status, 0);
    const diagnostic = result.stderr + result.stdout;
    assert.match(diagnostic, /review-package files/);
    assert.equal(diagnostic.includes(canonicalKey), true);
  } finally {
    await rm(aliasRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

test('review integrity reports exact tracked staged and untracked mutations without repair', async () => {
  const repo = await tempRepo();
  try {
    const script = path.join(root, 'scripts/review-integrity.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    let result = run(process.execPath, [script, 'capture', '--base', head, '--head', head], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = result.stdout.trim();

    await writeFile(path.join(repo, 'tracked.txt'), 'reviewer changed\n');
    await writeFile(path.join(repo, 'staged.txt'), 'staged\n');
    assert.equal(run('git', ['add', 'staged.txt'], repo).status, 0);
    await writeFile(path.join(repo, 'untracked.txt'), 'untracked\n');
    result = run(process.execPath, [script, 'verify', '--receipt', receipt], repo);
    assert.notEqual(result.status, 0);
    const diagnostic = result.stderr + result.stdout;
    assert.match(diagnostic, /REVIEW_CHECKOUT_CHANGED/);
    for (const file of ['tracked.txt', 'staged.txt', 'untracked.txt']) assert.match(diagnostic, new RegExp(file));
    assert.match(diagnostic, /untracked files: untracked\.txt/);
    assert.equal(run('git', ['diff', '--cached', '--name-only'], repo).stdout.trim(), 'staged.txt');
    assert.equal(await readFile(path.join(repo, 'tracked.txt'), 'utf8'), 'reviewer changed\n');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('review integrity reports only mutations made after capture in an already-dirty checkout', async () => {
  const repo = await tempRepo();
  try {
    await writeFile(path.join(repo, 'preexisting.txt'), 'base\n');
    assert.equal(run('git', ['add', 'preexisting.txt'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'add preexisting'], repo).status, 0);
    await writeFile(path.join(repo, 'preexisting.txt'), 'owner change\n');

    const script = path.join(root, 'scripts/review-integrity.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    let result = run(process.execPath, [script, 'capture', '--base', head, '--head', head], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = result.stdout.trim();

    await writeFile(path.join(repo, 'tracked.txt'), 'reviewer mutation\n');
    result = run(process.execPath, [script, 'verify', '--receipt', receipt], repo);
    assert.notEqual(result.status, 0);
    const diagnostic = result.stderr + result.stdout;
    assert.match(diagnostic, /tracked working-tree files: tracked\.txt/);
    assert.doesNotMatch(diagnostic, /preexisting\.txt/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('review integrity uses worktree-specific Git-local state in linked worktrees', async () => {
  const repo = await tempRepo();
  const linked = `${repo}-linked`;
  try {
    assert.equal(run('git', ['worktree', 'add', '-b', 'review-test', linked], repo).status, 0);
    const script = path.join(root, 'scripts/review-integrity.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], linked).stdout.trim();
    let result = run(process.execPath, [script, 'capture', '--base', head, '--head', head], linked);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = result.stdout.trim();
    assert.match(receipt, /worktrees.*zimster.*review-integrity\.json/);
    await writeFile(path.join(linked, 'linked-new.txt'), 'mutation\n');
    result = run(process.execPath, [script, 'verify', '--receipt', receipt], linked);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /linked-new\.txt/);
  } finally {
    await rm(linked, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

test('change snapshots reject moving review ranges and record immutable base and head SHAs', async () => {
  const repo = await tempRepo();
  try {
    const snapshot = path.join(root, 'scripts/change-snapshot.mjs');
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    let result = run(process.execPath, [snapshot, '--base', 'main', '--head', head], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /immutable|40-character SHA/i);

    result = run(process.execPath, [snapshot, '--base', head, '--head', head], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const contents = await readFile(result.stdout.trim(), 'utf8');
    assert.match(contents, new RegExp(`Review base: .*${head}`));
    assert.match(contents, new RegExp(`Review head: .*${head}`));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
