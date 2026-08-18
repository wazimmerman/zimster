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

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('0.7.0 Git-local state migrates deterministically without inventing history', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-state-070-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'dirty in progress\n');
    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], repo).stdout.trim();
    const runState = {
      schema_version: 2,
      id: 'run-070',
      root_actor_id: 'root',
      started_at: '2026-08-01T00:00:00.000Z',
      starting_head: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
      plan: { id: 'recovery', source: 'owner request' },
      decisions: [{ id: 'kept-decision' }],
      slice_commits: ['a'.repeat(40)],
      evidence: ['evidence-070'],
      verifications: [],
      unresolved_risks: ['historical accounting incomplete']
    };
    const checkpoint = {
      schema_version: 1,
      mission_digest: 'Resume the existing 0.7.0 run.',
      invariants_and_non_goals: [],
      current_architecture: ['Existing slice already started'],
      completed_slice_commits: ['a'.repeat(40)],
      evidence_receipts: [{ id: 'evidence-070', status: 'valid' }],
      open_findings: ['latest failure was not recorded'],
      unavailable_evidence: ['exact test count unavailable'],
      exact_next_slice: 'Continue the existing bounded slice',
      relevant_files_and_interfaces: ['tracked.txt'],
      budget_position: { exact_duplicate_commands: 2 }
    };
    const budget = {
      schema_version: 1,
      profile: 'standard',
      limits: { exact_duplicate_commands: 2 },
      usage: { exact_duplicate_commands: 2 },
      scoped_usage: {},
      overrides: [],
      proof_obligations: []
    };
    await writeJson(path.join(runtime, 'run.json'), runState);
    await writeJson(path.join(runtime, 'checkpoints/current.json'), checkpoint);
    await writeJson(path.join(runtime, 'budget.json'), budget);
    await mkdir(path.join(runtime, 'evidence'), { recursive: true });
    const evidenceBytes = `${JSON.stringify({
      schema_version: 2,
      id: 'evidence-070',
      exit_code: 0,
      status: 'valid',
      requirement_ids: ['MIGRATE-001'],
      establishes: ['Existing evidence remains usable.']
    })}\n`;
    await writeFile(path.join(runtime, 'evidence/receipts.jsonl'), evidenceBytes);
    for (const [relative, row] of [
      ['dispatches/dispatches.jsonl', { id: 'dispatch-070' }],
      ['delegation/decisions.jsonl', { id: 'delegation-070', selected: true }],
      ['reviews/history.jsonl', { id: 'review-070', verdict: 'needs_correction' }]
    ]) {
      await mkdir(path.dirname(path.join(runtime, relative)), { recursive: true });
      await writeFile(path.join(runtime, relative), `${JSON.stringify(row)}\n`);
    }
    const preserved = new Map();
    for (const relative of [
      'checkpoints/current.json', 'budget.json', 'evidence/receipts.jsonl',
      'dispatches/dispatches.jsonl', 'delegation/decisions.jsonl', 'reviews/history.jsonl'
    ]) preserved.set(relative, await readFile(path.join(runtime, relative), 'utf8'));

    const script = path.join(root, 'scripts/migrate-state.mjs');
    let result = run(process.execPath, [script], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const migrated = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    assert.equal(migrated.id, 'run-070');
    assert.equal(migrated.current_slice.status, 'in_progress');
    assert.equal(migrated.current_slice.summary, 'Existing slice already started');
    assert.deepEqual(migrated.current_slice.touched_files, ['tracked.txt']);
    assert.equal(migrated.recovery.next_action, 'Continue the existing bounded slice');
    assert.equal(migrated.recovery.latest_failure, null);
    assert.equal(migrated.recovery.latest_test, null);
    assert.equal(migrated.recovery.next_command, null);
    assert.equal(Object.hasOwn(migrated, 'approval'), false);

    for (const [relative, before] of preserved) {
      assert.equal(await readFile(path.join(runtime, relative), 'utf8'), before, relative);
    }
    const reportPath = path.join(runtime, 'migration-0.7.0.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(report.preserved_records, {
      delegation_decisions: 1,
      dispatches: 1,
      evidence_receipts: 1,
      review_history: 1
    });
    assert.equal(report.known_budget_usage.exact_duplicate_commands, 2);
    assert.ok(report.unknown_budget_metrics.includes('complete_suite_executions'));
    assert.equal(report.approval_state, 'unavailable');
    assert.ok(report.unknown_facts.includes('latest_failure'));

    const firstRun = await readFile(path.join(runtime, 'run.json'), 'utf8');
    const firstReport = await readFile(reportPath, 'utf8');
    result = run(process.execPath, [script], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(path.join(runtime, 'run.json'), 'utf8'), firstRun);
    assert.equal(await readFile(reportPath, 'utf8'), firstReport);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
