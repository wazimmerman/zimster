import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-ops-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

test('change snapshot includes staged, unstaged, and untracked content without modifying the index', async () => {
  const repo = await tempRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');
    await writeFile(path.join(repo, 'new-file.txt'), 'brand new\n');
    const before = run('git', ['diff', '--cached', '--name-only'], repo).stdout;
    const output = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/change-snapshot.md'], repo).stdout.trim();
    const result = run(process.execPath, [path.join(root, 'scripts/change-snapshot.mjs')], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = await readFile(output, 'utf8');
    assert.match(snapshot, /tracked\.txt/);
    assert.match(snapshot, /new-file\.txt/);
    assert.match(snapshot, /brand new/);
    const after = run('git', ['diff', '--cached', '--name-only'], repo).stdout;
    assert.equal(after, before, 'snapshot must not mutate the index');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence receipts become stale when the working tree changes and detect reusable duplicates', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [evidence, 'init'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [evidence, 'record', '--kind', 'focused', '--scope', 'focused', '--command', 'node --test', '--exit-code', '0', '--tests-passed', '1', '--tests-failed', '0'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(receipt.behavioral_evidence, true);
    assert.equal(receipt.invalidation_reason, null);

    result = run(process.execPath, [evidence, 'check', '--id', receipt.id], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /VALID/);

    result = run(process.execPath, [evidence, 'find', '--kind', 'focused', '--command', 'node --test'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /REUSABLE_DUPLICATE/);

    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');
    result = run(process.execPath, [evidence, 'check', '--id', receipt.id], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /STALE/);
    const runtimeStatus = run('git', ['status', '--short', '--untracked-files=all'], repo).stdout;
    assert.doesNotMatch(runtimeStatus, /\.zimster/, 'runtime receipts must not pollute Git status');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence receipts record harness capabilities and support a no-state opt-out', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'test', '--scope', 'focused',
      '--command', 'node --test', '--exit-code', '0',
      '--tests-passed', '1', '--tests-failed', '0', '--harness', 'codex'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.harness, 'codex');
    assert.equal(receipt.capabilities.native_skill_loading, 'unverified');

    const optedOut = await tempRepo();
    try {
      result = run(process.execPath, [
        evidence, 'record', '--kind', 'test', '--scope', 'focused',
        '--command', 'node --test', '--exit-code', '0', '--no-receipt'
      ], optedOut);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /RECEIPTS_DISABLED/);
      const runtime = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/evidence/receipts.jsonl'], optedOut).stdout.trim();
      await assert.rejects(readFile(runtime, 'utf8'), /ENOENT/);
    } finally {
      await rm(optedOut, { recursive: true, force: true });
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('doctor exposes the shared capability vocabulary without warning on JSON output', async () => {
  const result = run(process.execPath, [path.join(root, 'scripts/doctor.mjs'), '--json'], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  const allowed = new Set([
    'native', 'supported_with_constraints', 'prompt_constrained',
    'inline_fallback', 'unavailable', 'unverified'
  ]);
  for (const harness of ['codex', 'claude', 'cursor', 'kimi', 'opencode', 'pi']) {
    assert.ok(report.harnesses[harness]);
    for (const state of Object.values(report.harnesses[harness].capabilities)) {
      assert.equal(allowed.has(state), true, `${harness} uses unknown capability state ${state}`);
    }
  }
});

test('dispatch recorder stores abstract tier plus requested and effective model evidence', async () => {
  const repo = await tempRepo();
  try {
    const dispatch = path.join(root, 'scripts/dispatch-record.mjs');
    let result = run(process.execPath, [dispatch, 'init'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [dispatch, 'record', '--role', 'scout', '--purpose', 'inspect cache call sites', '--tier', 'fast', '--requested-model', 'fast-default', '--requested-effort', 'low', '--effective-model', 'unverified', '--effective-effort', 'unverified', '--parent-model', 'expert-parent', '--turn-limit', '12'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let row = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(row.tier, 'fast');
    assert.equal(row.requested_model, 'fast-default');
    assert.equal(row.effective_model, 'unverified');

    result = run(process.execPath, [dispatch, 'update', '--id', row.id, '--effective-model', 'expert-parent', '--effective-effort', 'high', '--agent-id', 'agent-1'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    row = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(row.effective_model, 'expert-parent');
    assert.match(row.warning, /inherited the parent model/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('run-state initializer creates the durable record deterministically', async () => {
  const repo = await tempRepo();
  try {
    const init = path.join(root, 'scripts/init-run.mjs');
    const result = run(process.execPath, [init, '--profile', 'standard', '--reason', 'two slices'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtimePath = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/run.md'], repo).stdout.trim();
    const runMd = await readFile(runtimePath, 'utf8');
    assert.match(runMd, /Profile and rationale/);
    assert.match(runMd, /standard/i);
    assert.match(runMd, /Git disposition/);
    await assert.rejects(readFile(path.join(repo, '.zimster/run.md'), 'utf8'), /ENOENT/);
    const runtimeStatus = run('git', ['status', '--short', '--untracked-files=all'], repo).stdout;
    assert.doesNotMatch(runtimeStatus, /\.zimster/, 'durable state must be locally ignored');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('run-state audit mode is explicit and writes only the requested project path', async () => {
  const repo = await tempRepo();
  try {
    const init = path.join(root, 'scripts/init-run.mjs');
    const result = run(process.execPath, [
      init, '--profile', 'high-risk', '--reason', 'audit evidence',
      '--audit-path', 'docs/audit/zimster-run.md'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const audit = await readFile(path.join(repo, 'docs/audit/zimster-run.md'), 'utf8');
    assert.match(audit, /High risk/);
    assert.match(run('git', ['status', '--short', '--untracked-files=all'], repo).stdout, /docs\/audit\/zimster-run\.md/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('version checker rejects a release tag that does not match package metadata', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  let result = run(process.execPath, ['scripts/check-version.mjs', '--tag', `v${packageJson.version}`], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = run(process.execPath, ['scripts/check-version.mjs', '--tag', 'v9.9.9'], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /does not match/i);
});


test('project command discovery prefers repository declarations and inventories CI', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-commands-'));
  try {
    await mkdir(path.join(repo, '.github', 'workflows'), { recursive: true });
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', build: 'node build.mjs' } }));
    await writeFile(path.join(repo, 'AGENTS.md'), '# Instructions\n');
    await writeFile(path.join(repo, '.github', 'workflows', 'ci.yml'), 'steps:\n  - run: npm test\n');
    const result = run(process.execPath, [path.join(root, 'scripts/project-commands.mjs'), repo], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const inventory = JSON.parse(result.stdout);
    assert.ok(inventory.instructions.includes('AGENTS.md'));
    assert.ok(inventory.commands.some((item) => item.source === 'package.json' && item.name === 'test' && item.command === 'npm test'));
    assert.ok(inventory.commands.some((item) => item.source.includes('.github/workflows') && item.command === 'npm test'));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
