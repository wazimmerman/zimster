import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import { createZip } from '../scripts/lib/zip.mjs';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-helper-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'safe\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

test('archive safety rejects traversal entries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-unsafe-archive-'));
  try {
    await createZip(path.join(directory, 'candidate.zip'), [
      ['../escape.txt', { data: Buffer.from('unsafe\n'), mode: 0o644 }]
    ]);
    const result = run(process.execPath, [
      path.join(root, 'scripts/archive-safety.mjs'), '--dist', directory
    ], root);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'failed');
    assert.match(summary.violations[0], /traversal|unsafe|\.\./i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exact candidate archives pass safety and installed-package smoke', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-installed-smoke-'));
  try {
    await createPackages(directory);
    let result = run(process.execPath, [
      path.join(root, 'scripts/archive-safety.mjs'), '--dist', directory
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).archives, 3);

    result = run(process.execPath, [
      path.join(root, 'scripts/installed-package-smoke.mjs'), '--dist', directory
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.deepEqual(summary.targets.map(({ target }) => target), ['claude', 'codex', 'portable']);
    assert.equal(summary.targets.every(({ status }) => status === 'passed'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('secret scan reports worktree and archived credential material without printing it', async () => {
  const repo = await tempRepo();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-secret-archive-'));
  try {
    const secret = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    await writeFile(path.join(repo, 'credential.txt'), `${secret}\nredacted\n`);
    await createZip(path.join(directory, 'candidate.zip'), [
      ['credential.txt', { data: Buffer.from(`${secret}\nredacted\n`), mode: 0o644 }]
    ]);
    const result = run(process.execPath, [
      path.join(root, 'scripts/secret-scan.mjs'), '--root', repo, '--dist', directory
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /redacted/);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.findings.some(({ source }) => source === 'worktree'), true);
    assert.equal(summary.findings.some(({ source }) => source === 'archive'), true);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured host smoke runs in isolated homes and records unavailable hosts', async () => {
  const repo = await tempRepo();
  try {
    const config = path.join(repo, 'host-smoke.json');
    await writeFile(config, `${JSON.stringify({
      schema_version: 1,
      hosts: [
        {
          id: 'available-host',
          command: process.execPath,
          args: [
            '-e',
            "if (process.env.HOME === process.argv[1]) process.exit(2);",
            os.homedir()
          ]
        },
        {
          id: 'missing-host',
          unavailable_reason: 'CLI is not installed'
        }
      ]
    })}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs'), '--config', config
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.deepEqual(summary.executed, ['available-host']);
    assert.deepEqual(summary.unavailable, [{
      id: 'missing-host',
      reason: 'CLI is not installed'
    }]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('default host smoke records every unconfigured harness as unavailable', () => {
  const result = run(process.execPath, [
    path.join(root, 'scripts/host-smoke.mjs')
  ], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'passed');
  assert.deepEqual(summary.executed, []);
  assert.deepEqual(
    summary.unavailable.map(({ id }) => id),
    ['claude', 'codex', 'cursor', 'kimi', 'opencode', 'pi']
  );
});
