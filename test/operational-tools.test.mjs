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

test('evidence reuse requires the recorded host environment and external inputs to remain valid', async () => {
  const repo = await tempRepo();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'zimster-evidence-input-'));
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const fixture = path.join(fixtureDirectory, 'external-fixture.txt');
    await writeFile(fixture, 'fixture-v1\n');

    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'integration', '--scope', 'affected',
      '--command', 'host smoke', '--exit-code', '0',
      '--host-version', 'host-1.0.0', '--inputs', fixture
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.environment.host_version, 'host-1.0.0');
    assert.equal(receipt.input_fingerprints.length, 1);

    result = run(process.execPath, [
      evidence, 'check', '--id', receipt.id, '--host-version', 'host-1.0.0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'integration', '--scope', 'affected',
      '--command', 'host smoke', '--host-version', 'host-2.0.0', '--inputs', fixture
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /NO_REUSABLE_EVIDENCE/);

    await writeFile(fixture, 'fixture-v2\n');
    result = run(process.execPath, [
      evidence, 'check', '--id', receipt.id, '--host-version', 'host-1.0.0'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /STALE.*input/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(fixtureDirectory, { recursive: true, force: true });
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

test('evidence rejects contradictory test metadata before appending a receipt', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    for (const args of [
      ['--test-discovery', 'tests_executed', '--tests-passed', '1', '--tests-failed', '0', '--tests-discovered', '9'],
      ['--test-discovery', 'zero_discovered', '--tests-passed', '1', '--tests-failed', '0'],
      ['--test-discovery', 'unknown', '--tests-passed', '1', '--tests-failed', '0'],
      ['--test-discovery', 'tests_executed', '--tests-passed', '0', '--tests-failed', '1', '--behavioral-evidence', 'true']
    ]) {
      const result = run(process.execPath, [
        evidence, 'record', '--kind', 'test', '--scope', 'focused',
        '--command', 'node --test', '--exit-code', args.includes('--behavioral-evidence') ? '1' : '0',
        ...args
      ], repo);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /contradict|discovered|behavioral evidence|test metadata/i);
    }
    const receiptsPath = run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/evidence/receipts.jsonl'],
      repo
    ).stdout.trim();
    assert.equal(await readFile(receiptsPath, 'utf8'), '');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('receipt opt-out suppresses state initialization for every evidence action', async () => {
  for (const actionArgs of [
    ['init'],
    ['list'],
    ['check', '--id', 'missing'],
    ['find', '--kind', 'test', '--command', 'node --test']
  ]) {
    const repo = await tempRepo();
    try {
      const result = run(process.execPath, [
        path.join(root, 'scripts/evidence.mjs'), ...actionArgs, '--no-receipt'
      ], repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /RECEIPTS_DISABLED/);
      const receiptsPath = run(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/evidence/receipts.jsonl'],
        repo
      ).stdout.trim();
      await assert.rejects(readFile(receiptsPath, 'utf8'), /ENOENT/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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

test('run-state initializer creates the durable record with machine-readable capability state', async () => {
  const repo = await tempRepo();
  try {
    const init = path.join(root, 'scripts/init-run.mjs');
    const result = run(process.execPath, [
      init, '--profile', 'standard', '--reason', 'two slices', '--harness', 'codex'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtimePath = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/run.md'], repo).stdout.trim();
    const runMd = await readFile(runtimePath, 'utf8');
    assert.match(runMd, /Profile and rationale/);
    assert.match(runMd, /standard/i);
    assert.match(runMd, /Git disposition/);
    const capabilityBlock = runMd.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(capabilityBlock, 'run record must carry a JSON capability receipt');
    const capabilityReceipt = JSON.parse(capabilityBlock[1]);
    assert.equal(capabilityReceipt.harness, 'codex');
    assert.equal(capabilityReceipt.capabilities.native_skill_loading, 'unverified');
    await assert.rejects(readFile(path.join(repo, '.zimster/run.md'), 'utf8'), /ENOENT/);
    const runtimeStatus = run('git', ['status', '--short', '--untracked-files=all'], repo).stdout;
    assert.doesNotMatch(runtimeStatus, /\.zimster/, 'durable state must be locally ignored');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('run-state migration never overwrites an existing Git-local run record', async () => {
  const repo = await tempRepo();
  try {
    const runtimePath = run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/run.md'],
      repo
    ).stdout.trim();
    await mkdir(path.dirname(runtimePath), { recursive: true });
    await writeFile(runtimePath, '# Current Git-local state\n');
    const legacy = path.join(repo, '.zimster/run.md');
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, '# Legacy state\n');

    const result = run(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'standard'
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /both exist|reconcile|already exists/i);
    assert.equal(await readFile(runtimePath, 'utf8'), '# Current Git-local state\n');
    assert.equal(await readFile(legacy, 'utf8'), '# Legacy state\n');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('run-state migration adds a requested machine-readable harness receipt to legacy state', async () => {
  const repo = await tempRepo();
  try {
    const legacy = path.join(repo, '.zimster/run.md');
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, '# Legacy run\n\n## Architecture and current slice\n\nOld state.\n');

    const result = run(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'standard', '--harness', 'codex'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const migrated = await readFile(result.stdout.trim(), 'utf8');
    assert.match(migrated, /# Legacy run/);
    const capabilityBlock = migrated.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(capabilityBlock);
    const capabilityReceipt = JSON.parse(capabilityBlock[1]);
    assert.equal(capabilityReceipt.harness, 'codex');
    assert.equal(capabilityReceipt.capabilities.native_skill_loading, 'unverified');
    await assert.rejects(readFile(legacy, 'utf8'), /ENOENT/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('legacy evidence and dispatch records migrate into Git-local stores without loss', async () => {
  const repo = await tempRepo();
  try {
    const legacyEvidence = path.join(repo, '.zimster/evidence');
    const legacyDispatches = path.join(repo, '.zimster/dispatches');
    await mkdir(legacyEvidence, { recursive: true });
    await mkdir(legacyDispatches, { recursive: true });
    await writeFile(path.join(legacyEvidence, 'receipts.jsonl'), '{"id":"legacy-evidence"}\n');
    await writeFile(path.join(legacyEvidence, 'keep-diagnostic.txt'), 'preserve me\n');
    await writeFile(path.join(legacyDispatches, 'dispatches.jsonl'), '{"id":"legacy-dispatch"}\n');

    let result = run(process.execPath, [path.join(root, 'scripts/evidence.mjs'), 'init'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [path.join(root, 'scripts/dispatch-record.mjs'), 'init'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const runtime = run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'zimster'],
      repo
    ).stdout.trim();
    assert.match(await readFile(path.join(runtime, 'evidence/receipts.jsonl'), 'utf8'), /legacy-evidence/);
    assert.match(await readFile(path.join(runtime, 'dispatches/dispatches.jsonl'), 'utf8'), /legacy-dispatch/);
    await assert.rejects(readFile(path.join(legacyEvidence, 'receipts.jsonl'), 'utf8'), /ENOENT/);
    assert.equal(await readFile(path.join(legacyEvidence, 'keep-diagnostic.txt'), 'utf8'), 'preserve me\n');
    await assert.rejects(readFile(path.join(legacyDispatches, 'dispatches.jsonl'), 'utf8'), /ENOENT/);
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
