import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import { createZip } from '../scripts/lib/zip.mjs';
import { createTarGzip } from '../scripts/lib/tar.mjs';
import { root } from './helpers.mjs';

const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('release reconstruction helpers are exact-candidate programs with fresh-checkout boundaries', async () => {
  const reproducibility = await readFile(
    path.join(root, 'scripts/clean-checkout-reproducibility.mjs'), 'utf8'
  );
  const selfHost = await readFile(path.join(root, 'scripts/selfhost-reconstruction.mjs'), 'utf8');
  assert.match(reproducibility, /clone/);
  assert.match(reproducibility, /checkout/);
  assert.match(reproducibility, /secret-scan\.mjs/);
  assert.match(selfHost, /clone/);
  assert.match(selfHost, /checkout/);
  assert.match(selfHost, /governed-execution\.test\.mjs/);
  assert.doesNotMatch(selfHost, /assurance-accounting\/latest\.json|review-lifecycle\/whole-release\.json/);
});

async function createExactPortableArchive(dist, head = 'a'.repeat(40), tree = 'b'.repeat(40)) {
  await mkdir(dist, { recursive: true });
  await createZip(path.join(dist, 'zimster-0.6.0-portable.zip'), [
    ['.opencode/plugins/zimster.js', { data: Buffer.from('export default {};\n'), mode: 0o644 }],
    ['skills/using-zimster/references/build-metadata.json', {
      data: Buffer.from(`${JSON.stringify({
        schema_version: 1,
        semantic_version: '0.6.0',
        source_commit: head,
        source_tree: tree,
        source_dirty_tree_fingerprint: CLEAN_FINGERPRINT,
        build_date: '2026-08-04T00:00:00.000Z',
        build_id: `zimster-0.6.0-${head.slice(0, 12)}-portable`,
        package_target: 'portable'
      }, null, 2)}\n`),
      mode: 0o644
    }]
  ]);
}

function run(command, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(command, args, { cwd, encoding: 'utf8', env });
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
    assert.equal(JSON.parse(result.stdout).archives, 5);

    result = run(process.execPath, [
      path.join(root, 'scripts/installed-package-smoke.mjs'), '--dist', directory
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.deepEqual(summary.targets.map(({ target }) => target), ['claude', 'codex', 'openai', 'portable', 'npm']);
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
    await createTarGzip(path.join(directory, 'candidate.tgz'), [
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
    assert.equal(summary.archives, 2);
    assert.equal(summary.findings.some(({ source }) => source === 'worktree'), true);
    assert.equal(summary.findings.some(({ source }) => source === 'archive'), true);
    assert.equal(summary.findings.some(({ file }) => file.startsWith('candidate.tgz:')), true);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured host smoke passes public beta with one live host and classifies unavailable hosts independently', async () => {
  const repo = await tempRepo();
  const dist = path.join(repo, 'dist');
  try {
    await createExactPortableArchive(dist);
    const config = path.join(repo, 'host-smoke.json');
    await writeFile(config, `${JSON.stringify({
      schema_version: 1,
      hosts: [
        {
          id: 'available-host',
          candidate: 'portable',
          proof_kind: 'exact_package_install_and_fresh_session_discovery',
          command: process.execPath,
          args: [
            '-e',
            "if (process.env.HOME === process.argv[1]) process.exit(2);",
            os.homedir()
          ]
        },
        {
          id: 'missing-host',
          candidate: 'portable',
          proof_kind: 'exact_package_install_and_fresh_session_discovery',
          unavailable_reason: 'CLI is not installed'
        }
      ]
    })}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs'), '--config', config, '--dist', dist,
      '--candidate-head', 'a'.repeat(40), '--candidate-tree', 'b'.repeat(40),
      '--dirty-tree-fingerprint', CLEAN_FINGERPRINT
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.release_channel, 'public_beta');
    assert.deepEqual(summary.executed, ['available-host']);
    assert.deepEqual(summary.unavailable, [{
      id: 'missing-host',
      reason: 'CLI is not installed'
    }]);
    assert.equal(summary.hosts.find(({ id }) => id === 'available-host').verification_state, 'LIVE_VERIFIED');
    assert.equal(summary.hosts.find(({ id }) => id === 'missing-host').verification_state, 'UNAVAILABLE');
    assert.equal(summary.hosts.find(({ id }) => id === 'missing-host').model_backed_execution, false);

    const unsafeConfig = path.join(repo, 'unsafe-host-smoke.json');
    await writeFile(unsafeConfig, `${JSON.stringify({
      schema_version: 1,
      hosts: [{
        id: 'unsafe-host', candidate: 'portable',
        proof_kind: 'exact_package_install_and_fresh_session_discovery',
        command: process.execPath, args: ['-e', ''], env: { HOME: '/not-isolated' }
      }]
    })}\n`);
    const unsafe = run(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs'), '--config', unsafeConfig, '--dist', dist,
      '--candidate-head', 'a'.repeat(40), '--candidate-tree', 'b'.repeat(40),
      '--dirty-tree-fingerprint', CLEAN_FINGERPRINT
    ], repo);
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /isolation-critical environment/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('default host smoke records every unconfigured harness as unavailable without dist', async () => {
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'zimster-clean-checkout-'));
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => (
        name.toLowerCase() !== 'path' && name !== 'NODE_TEST_CONTEXT'
      ))
    );
    env.PATH = '';
    const result = spawnSync(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs')
    ], {
      cwd: checkout,
      encoding: 'utf8',
      env
    });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'BLOCKED_BY_ENVIRONMENT');
    assert.equal(summary.hosts.every(({ verification_state }) => verification_state === 'UNAVAILABLE'), true);
    assert.deepEqual(summary.executed, []);
    assert.deepEqual(
      summary.unavailable.map(({ id }) => id).sort(),
      ['claude', 'codex', 'grok', 'kimi', 'opencode', 'pi']
    );
    await assert.rejects(readFile(path.join(checkout, 'dist')), /ENOENT|EISDIR/);
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});

test('host smoke runs a configured command from the extracted exact candidate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-host-candidate-'));
  try {
    const dist = path.join(directory, 'dist');
    await createExactPortableArchive(dist);
    const config = path.join(directory, 'host-smoke.json');
    await writeFile(config, `${JSON.stringify({
      schema_version: 1,
      hosts: [{
        id: 'candidate-host',
        candidate: 'portable',
        proof_kind: 'exact_package_install_and_fresh_session_discovery',
        command: process.execPath,
        args: ['-e', "import { accessSync, writeSync } from 'node:fs'; accessSync('.opencode/plugins/zimster.js'); writeSync(process.stdout.fd, 'using-zimster');"],
        expected_output: 'using-zimster'
      }]
    })}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs'),
      '--config', config, '--dist', dist,
      '--candidate-head', 'a'.repeat(40), '--candidate-tree', 'b'.repeat(40),
      '--dirty-tree-fingerprint', CLEAN_FINGERPRINT
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.deepEqual(summary.executed, ['candidate-host']);
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.hosts[0].verification_state, 'LIVE_VERIFIED');
    assert.equal(summary.hosts[0].model_backed_execution, false);
    assert.equal(summary.hosts[0].fresh_session_discovery, true);
    assert.match(summary.hosts[0].archive_sha256, /^[0-9a-f]{64}$/);
    assert.equal(summary.hosts[0].candidate_commit, 'a'.repeat(40));
    assert.equal(summary.hosts[0].candidate_tree, 'b'.repeat(40));

    const stale = run(process.execPath, [
      path.join(root, 'scripts/host-smoke.mjs'),
      '--config', config, '--dist', dist,
      '--candidate-head', 'c'.repeat(40), '--candidate-tree', 'b'.repeat(40),
      '--dirty-tree-fingerprint', CLEAN_FINGERPRINT
    ], root);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /archive provenance.*candidate head and tree/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
