import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function commit(repo, message) {
  assert.equal(run('git', ['add', '.'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', message], repo).status, 0);
  return run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
}

test('review package keeps authoritative changes and hashes generated mirrors without duplication', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-package-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-requirements-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await mkdir(path.join(repo, 'scripts'), { recursive: true });
    await mkdir(path.join(repo, 'plugins/zimster/scripts'), { recursive: true });
    await writeFile(path.join(repo, 'scripts/example.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(repo, 'plugins/zimster/scripts/example.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(repo, 'interface.json'), '{"schema_version":1}\n');
    const base = await commit(repo, 'base');

    await writeFile(path.join(repo, 'scripts/example.mjs'), 'export const value = 2;\n');
    await writeFile(path.join(repo, 'plugins/zimster/scripts/example.mjs'), 'export const value = 2;\n');
    const head = await commit(repo, 'change');

    const evidence = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'record',
      '--kind', 'test', '--scope', 'affected', '--command', 'node --test',
      '--exit-code', '0', '--tests-passed', '1', '--tests-failed', '0'
    ], repo);
    assert.equal(evidence.status, 0, evidence.stderr || evidence.stdout);
    const receipt = JSON.parse(evidence.stdout);
    const requirements = path.join(external, 'requirements.md');
    await writeFile(requirements, '# Mission\n\nKeep review packages compact.\n');

    const result = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', base,
      '--head', head,
      '--requirements', requirements,
      '--interfaces', 'interface.json',
      '--lenses', 'mission,state-authority'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.length < 2000);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'created');
    assert.equal(summary.base, base);
    assert.equal(summary.head, head);

    const review = JSON.parse(await readFile(summary.package, 'utf8'));
    assert.deepEqual(review.authoritative_changed_files.map(({ path: file }) => file), [
      'scripts/example.mjs'
    ]);
    assert.deepEqual(review.generated_mirrors.map(({ path: file }) => file), [
      'plugins/zimster/scripts/example.mjs'
    ]);
    assert.equal(review.generated_mirrors[0].canonical_path, 'scripts/example.mjs');
    assert.equal(review.generated_mirrors[0].synchronized, true);
    assert.equal(Object.hasOwn(review.generated_mirrors[0], 'content'), false);
    assert.deepEqual(review.relevant_unchanged_interfaces.map(({ path: file }) => file), [
      'interface.json'
    ]);
    assert.deepEqual(review.lenses, ['mission', 'state-authority']);
    assert.equal(review.evidence.some(({ id }) => id === receipt.id), true);
    const diff = await readFile(review.authoritative_diff, 'utf8');
    assert.match(diff, /scripts\/example\.mjs/);
    assert.doesNotMatch(diff, /plugins\/zimster/);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('review package rejects mutable base or head references', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-sha-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await commit(repo, 'base');
    const result = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', 'main', '--head', 'HEAD'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /immutable|40-character|sha/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
