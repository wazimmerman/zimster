import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-governed-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  const initialized = run(process.execPath, [
    path.join(root, 'scripts/init-run.mjs'),
    '--profile', 'high-risk',
    '--reason', 'governed execution fixture'
  ], repo);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return repo;
}

function runtimePath(repo, ...parts) {
  const runtime = run(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'zimster'],
    repo
  ).stdout.trim();
  return path.join(runtime, ...parts);
}

async function writePlan(repo, name, profile = 'suite-fixture', completeSuite = true) {
  const file = runtimePath(repo, `${name}.json`);
  await writeFile(file, `${JSON.stringify({
    schema_version: 1,
    profile,
    complete_suite: completeSuite,
    steps: [{
      id: 'passes',
      command: process.execPath,
      args: ['-e', 'process.exit(0);']
    }]
  })}\n`);
  return file;
}

function verify(repo, plan) {
  return run(process.execPath, [path.join(root, 'scripts/verify.mjs'), 'run', '--plan', plan], repo);
}

async function executionReceipts(repo) {
  const directory = runtimePath(repo, 'executions', 'receipts');
  let files;
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(files.map(async (name) =>
    JSON.parse(await readFile(path.join(directory, name), 'utf8'))
  ));
}

test('three governed complete suites derive count three with start and finish receipts', async () => {
  const repo = await tempRepo();
  try {
    const plan = await writePlan(repo, 'suite-plan');
    const verificationIds = [];
    for (let index = 0; index < 3; index += 1) {
      const result = verify(repo, plan);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      verificationIds.push(JSON.parse(result.stdout).id);
    }
    const budget = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(budget.usage.complete_suite_executions, 3);
    const receipts = await executionReceipts(repo);
    assert.equal(receipts.length, 3);
    assert.deepEqual(receipts.map(({ status }) => status), ['passed', 'passed', 'passed']);
    assert.deepEqual(receipts.map(({ complete_suite }) => complete_suite), [true, true, true]);
    assert.deepEqual(
      receipts.map(({ terminal_receipt_id }) => terminal_receipt_id).sort(),
      verificationIds.sort()
    );
    for (const receipt of receipts) {
      assert.match(receipt.id, /^[0-9a-f-]{36}$/);
      assert.match(receipt.command_identity, /^[0-9a-f]{64}$/);
      assert.match(receipt.candidate.head, /^[0-9a-f]{40}$/);
      assert.match(receipt.candidate.tree, /^[0-9a-f]{40}$/);
      assert.match(receipt.candidate.dirty_tree_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(receipt.issuer, 'zimster.verify');
      assert.equal(receipt.environment.node, process.version);
      assert.equal(receipt.environment.platform, os.platform());
      assert.equal(receipt.runtime_provenance.semantic_version, '0.7.1');
      assert.ok(receipt.governing_policy);
    }
    const ledger = (await readFile(runtimePath(repo, 'executions', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(ledger.filter(({ event_type }) => event_type === 'execution_started').length, 3);
    assert.equal(ledger.filter(({ event_type }) => event_type === 'execution_finished').length, 3);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('exact duplicate accounting derives from governed identity including cwd and candidate', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const command = [process.execPath, '-e', 'process.exit(0);'];
    let result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused', '--', ...command
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused', '--force', '--', ...command
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let budget = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(budget.usage.exact_duplicate_commands, 1);

    const nested = path.join(repo, 'nested');
    await mkdir(nested);
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused', '--', ...command
    ], nested);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    budget = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(budget.usage.exact_duplicate_commands, 1);
    const receipts = (await executionReceipts(repo))
      .filter(({ issuer }) => issuer === 'zimster.evidence');
    assert.equal(receipts.length, 3);
    assert.deepEqual(receipts.map(({ duplicate_ordinal }) => duplicate_ordinal).sort(), [1, 1, 2]);
    assert.equal(new Set(receipts.map(({ command_identity }) => command_identity)).size, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('an ungoverned direct shell command is not falsely claimed as mechanically accounted', async () => {
  const repo = await tempRepo();
  try {
    const marker = path.join(repo, 'direct-shell-marker.txt');
    const direct = run(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran\\n')`], repo);
    assert.equal(direct.status, 0, direct.stderr || direct.stdout);
    const result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'), 'reconcile'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.unobserved_direct_shell_commands, 'not_observable');
    assert.equal(report.observed.complete_suite_executions, 0);
    assert.equal(report.observed.exact_duplicate_commands, 0);
    assert.equal((await executionReceipts(repo)).length, 0);
    const budget = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(budget.usage.complete_suite_executions, 0);
    assert.equal(budget.usage.exact_duplicate_commands, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('accounting is explicitly unverified when the authoritative budget is unavailable', async () => {
  const repo = await tempRepo();
  try {
    await rm(runtimePath(repo, 'budget.json'));
    const result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'), 'check', '--operation', 'completion'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'ACCOUNTING_UNVERIFIED');
    assert.equal(report.reason, 'budget.json is unavailable');
    assert.deepEqual(report.observed, {
      complete_suite_executions: 0,
      exact_duplicate_commands: 0
    });
    assert.deepEqual(report.supporting_execution_ids, {
      complete_suite_executions: [],
      exact_duplicate_commands: []
    });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('accounting mismatch blocks a dependent claim until audited reconciliation', async () => {
  const repo = await tempRepo();
  try {
    const plan = await writePlan(repo, 'suite-plan');
    for (let index = 0; index < 2; index += 1) {
      const result = verify(repo, plan);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const budgetFile = runtimePath(repo, 'budget.json');
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.usage.complete_suite_executions = 0;
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);

    let result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'),
      'check', '--operation', 'completion'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout + result.stderr, /STALE_ACCOUNTING/);

    result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'), 'reconcile'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'ACCOUNTING_RECONCILED');
    assert.equal(report.corrections[0].metric, 'complete_suite_executions');
    assert.equal(report.corrections[0].prior_value, 0);
    assert.equal(report.corrections[0].observed_value, 2);
    assert.equal(report.corrections[0].corrected_value, 2);
    assert.equal(report.corrections[0].supporting_execution_ids.length, 2);
    assert.equal((JSON.parse(await readFile(budgetFile, 'utf8'))).usage.complete_suite_executions, 2);
    const events = (await readFile(runtimePath(repo, 'events', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(events.some(({ event_type, metric }) =>
      event_type === 'accounting_reconciled' && metric === 'complete_suite_executions'
    ));
    result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'),
      'check', '--operation', 'completion'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a trusted receipt created after an override cannot circularly prove that override', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [
      budget, 'record',
      '--metric', 'complete_suite_executions',
      '--amount', '4',
      '--strategy-change', 'request one extra release proof',
      '--required-proof', 'independent release verification',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'release-proof'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = await writePlan(repo, 'release-proof-plan', 'release-proof', false);
    result = verify(repo, plan);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    result = run(process.execPath, [
      budget, 'prove',
      '--proof', 'independent release verification',
      '--receipt', receipt.id
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /circular|independent|postdates|precede/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('handcrafted proof is rejected while a trusted pre-existing matching receipt is accepted', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    const plan = await writePlan(repo, 'release-proof-plan', 'release-proof', false);
    let result = verify(repo, plan);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const trusted = JSON.parse(result.stdout);
    assert.match(trusted.execution_id, /^[0-9a-f-]{36}$/);

    result = run(process.execPath, [
      budget, 'record',
      '--metric', 'complete_suite_executions',
      '--amount', '4',
      '--strategy-change', 'request one extra release proof',
      '--required-proof', 'independent release verification',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'release-proof'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const obligation = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'))
      .proof_obligations.find(({ proof }) => proof === 'independent release verification');
    const trustedTerminalBytes = await readFile(
      runtimePath(repo, 'verification', 'receipts', `${trusted.id}.json`),
      'utf8'
    );
    const trustedTerminal = JSON.parse(trustedTerminalBytes);
    const trustedExecution = JSON.parse(await readFile(
      runtimePath(repo, 'executions', 'receipts', `${trusted.execution_id}.json`),
      'utf8'
    ));
    assert.equal(trustedTerminal.execution_id, trusted.execution_id);
    assert.equal(trustedTerminal.issuer, 'zimster.verify');
    assert.equal(trustedExecution.status, 'passed');
    assert.equal(trustedExecution.terminal_receipt_id, trusted.id);
    assert.equal(
      trustedExecution.terminal_receipt_sha256,
      createHash('sha256').update(trustedTerminalBytes).digest('hex')
    );
    assert.equal(typeof trustedExecution.runtime_provenance.runtime_origin, 'string');
    assert.equal(typeof trustedExecution.governing_policy.candidate_rules_authoritative, 'boolean');
    assert.ok(Date.parse(trustedExecution.ended_at) <= Date.parse(obligation.required_at));
    assert.equal(trustedTerminal.profile, obligation.profile);
    assert.equal(trustedTerminal.git_commit, run('git', ['rev-parse', 'HEAD'], repo).stdout.trim());
    assert.equal(trustedTerminal.git_tree, run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim());
    assert.equal(
      trustedTerminal.dirty_tree_fingerprint,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    assert.deepEqual(trustedTerminal.environment, {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version
    });

    const handcraftedId = 'handcrafted-proof';
    const forgedExecutionId = '00000000-0000-4000-8000-000000000001';
    const candidate = {
      head: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
      tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
      dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    };
    const forgedTerminalBytes = `${JSON.stringify({
      schema_version: 2,
      id: handcraftedId,
      issuer: 'zimster.verify',
      execution_id: forgedExecutionId,
      status: 'passed',
      profile: 'release-proof',
      git_commit: candidate.head,
      git_tree: candidate.tree,
      dirty_tree_fingerprint: candidate.dirty_tree_fingerprint,
      environment: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        node: process.version
      }
    }, null, 2)}\n`;
    await writeFile(
      runtimePath(repo, 'verification', 'receipts', `${handcraftedId}.json`),
      forgedTerminalBytes
    );
    await writeFile(runtimePath(repo, 'executions', 'receipts', `${forgedExecutionId}.json`), `${JSON.stringify({
      schema_version: 1,
      id: forgedExecutionId,
      issuer: 'zimster.verify',
      status: 'passed',
      command_identity: 'a'.repeat(64),
      complete_suite: true,
      started_at: '2020-01-01T00:00:00.000Z',
      ended_at: '2020-01-01T00:00:01.000Z',
      exit_code: 0,
      candidate,
      terminal_receipt_type: 'verification',
      terminal_receipt_id: handcraftedId,
      terminal_receipt_sha256: createHash('sha256').update(forgedTerminalBytes).digest('hex'),
      runtime_provenance: {
        semantic_version: '0.7.1',
        runtime_origin: 'forged',
        issuer: 'zimster.verify'
      },
      governing_policy: {
        runtime_role: 'governing_runtime',
        candidate_rules_authoritative: true
      }
    }, null, 2)}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/accounting-reconcile.mjs'), 'check'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const forgedAccounting = JSON.parse(result.stdout);
    assert.equal(forgedAccounting.observed.complete_suite_executions, 0);
    assert.equal(
      forgedAccounting.supporting_execution_ids.complete_suite_executions.includes(forgedExecutionId),
      false
    );
    result = run(process.execPath, [
      budget, 'prove',
      '--proof', 'independent release verification',
      '--receipt', handcraftedId
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /trusted|issuer|execution|provenance|relationship/i);

    result = run(process.execPath, [
      budget, 'prove',
      '--proof', 'independent release verification',
      '--receipt', trusted.id
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'BUDGET_PROOF_SATISFIED');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('one governed execution atomically crosses suite and duplicate limits with one proof relationship', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    const proofPlan = await writePlan(repo, 'proof-plan', 'release-proof', false);
    let result = verify(repo, proofPlan);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proof = JSON.parse(result.stdout);

    const suitePlan = await writePlan(repo, 'suite-plan', 'dual-limit-suite', true);
    const suiteArgv = [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', suitePlan,
      '--strategy-change', 'run one justified extra exact suite',
      '--required-proof', 'pre-existing release proof',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'release-proof'
    ];
    for (let index = 0; index < 4; index += 1) {
      result = run(process.execPath, suiteArgv, repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    assert.equal(JSON.parse(result.stdout).budget.status, 'BUDGET_OVERRIDE');
    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.complete_suite_executions, 4);
    assert.equal(state.usage.exact_duplicate_commands, 3);
    const obligation = state.proof_obligations.find(
      ({ proof: name }) => name === 'pre-existing release proof'
    );
    assert.deepEqual(
      obligation.metrics.sort(),
      ['complete_suite_executions', 'exact_duplicate_commands']
    );
    result = run(process.execPath, [
      budget, 'prove', '--proof', obligation.proof, '--receipt', proof.id
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
