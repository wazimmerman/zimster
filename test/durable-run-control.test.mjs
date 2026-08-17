import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-durable-run-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 41;\n');
  assert.equal(run('git', ['add', 'app.mjs'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
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

function initRun(repo) {
  return run(process.execPath, [
    path.join(root, 'scripts/init-run.mjs'),
    '--profile', 'high-risk',
    '--reason', 'interruption recovery fixture',
    '--plan-id', 'durable-fixture',
    '--plan-source', 'test requirement',
    '--next-slice-id', 'slice-1',
    '--next-slice-title', 'First observable slice',
    '--next-action', 'Start Slice 1 before editing.',
    '--next-command', 'node scripts/run-control.mjs start --slice-id slice-1'
  ], repo);
}

function control(repo, ...args) {
  return run(process.execPath, [path.join(root, 'scripts/run-control.mjs'), ...args], repo);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

test('initial run separates an empty current slice from the next slice and renders canonical state', async () => {
  const repo = await tempRepo();
  try {
    const result = initRun(repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = await readJson(runtimePath(repo, 'run.json'));
    assert.equal(state.schema_version, 3);
    assert.equal(state.state_revision, 0);
    assert.equal(state.current_slice, null);
    assert.deepEqual(state.next_slice, {
      id: 'slice-1',
      title: 'First observable slice'
    });
    assert.equal(state.exact_next_action, 'Start Slice 1 before editing.');
    assert.equal(
      state.exact_next_command,
      'node scripts/run-control.mjs start --slice-id slice-1'
    );

    const summary = await readFile(runtimePath(repo, 'run.md'), 'utf8');
    assert.match(summary, /generated.*canonical/i);
    assert.match(summary, /Current slice[\s\S]*None/);
    assert.match(summary, /Next slice[\s\S]*slice-1[\s\S]*First observable slice/);
    assert.match(summary, /Exact next action[\s\S]*Start Slice 1 before editing/);
    assert.doesNotMatch(summary, /\[Describe|\[Reference|## Architecture and current slice\s*$/m);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('slice start precedes dirty implementation and resume recovers touched files and guards', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    let result = control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--slice-title', 'First observable slice',
      '--next-slice-id', 'slice-2',
      '--next-slice-title', 'Second observable slice',
      '--remaining-obligations', JSON.stringify(['make answer correct', 'pass focused test']),
      '--next-action', 'Implement the failing behavior.',
      '--next-command', 'node --test focused.test.mjs'
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let state = await readJson(runtimePath(repo, 'run.json'));
    assert.equal(state.current_slice.id, 'slice-1');
    assert.equal(state.current_slice.status, 'in_progress');
    assert.match(state.current_slice.base_head, /^[0-9a-f]{40}$/);
    assert.match(state.current_slice.base_tree, /^[0-9a-f]{40}$/);
    assert.equal(state.next_slice.id, 'slice-2');
    const startedCheckpoint = await readJson(runtimePath(repo, 'checkpoints/current.json'));
    assert.equal(startedCheckpoint.recovery_status, 'SLICE_STARTED');
    assert.deepEqual(startedCheckpoint.repository_state.touched_files, []);
    const startEvents = (await readFile(runtimePath(repo, 'events/events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(startEvents.map(({ event_type }) => event_type), [
      'run_started',
      'slice_started'
    ]);

    await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 42;\n');
    await writeFile(path.join(repo, 'focused.test.mjs'), "throw new Error('still failing');\n");
    result = control(
      repo,
      'checkpoint',
      '--completed-obligations', JSON.stringify(['make answer correct']),
      '--remaining-obligations', JSON.stringify(['pass focused test']),
      '--blocking-obligations', JSON.stringify(['pass focused test']),
      '--unavailable-evidence', JSON.stringify(['Model-backed host proof remains unavailable']),
      '--guards', JSON.stringify([{
        id: 'external-mutation',
        statement: 'No external mutation occurred.',
        status: 'asserted'
      }]),
      '--next-action', 'Diagnose the focused failure.',
      '--next-command', 'node --test focused.test.mjs'
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const checkpoint = await readJson(runtimePath(repo, 'checkpoints/current.json'));
    assert.equal(checkpoint.schema_version, 2);
    assert.equal(checkpoint.current_slice.id, 'slice-1');
    assert.equal(checkpoint.current_slice.status, 'in_progress');
    assert.match(checkpoint.repository_state.dirty_tree_fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(checkpoint.repository_state.touched_files, ['app.mjs', 'focused.test.mjs']);
    assert.deepEqual(checkpoint.completed_obligations, ['make answer correct']);
    assert.deepEqual(checkpoint.remaining_obligations, ['pass focused test']);
    assert.deepEqual(checkpoint.blocking_obligations, ['pass focused test']);
    assert.deepEqual(checkpoint.unavailable_evidence, ['Model-backed host proof remains unavailable']);
    assert.equal(checkpoint.guards[0].statement, 'No external mutation occurred.');

    result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recovered = JSON.parse(result.stdout);
    assert.equal(recovered.current_slice.id, 'slice-1');
    assert.equal(recovered.current_slice.status, 'in_progress');
    assert.deepEqual(recovered.repository_state.touched_files, ['app.mjs', 'focused.test.mjs']);
    assert.deepEqual(recovered.remaining_obligations, ['pass focused test']);
    assert.equal(recovered.exact_next_action, 'Diagnose the focused failure.');
    assert.equal(recovered.exact_next_command, 'node --test focused.test.mjs');
    assert.equal(recovered.guards[0].status, 'asserted');
    const summary = await readFile(runtimePath(repo, 'run.md'), 'utf8');
    const currentSection = summary.match(/## Current slice\n\n([\s\S]*?)\n\n## Next slice/);
    assert.ok(currentSection);
    assert.doesNotMatch(currentSection[1], /None/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resume reconciles uncheckpointed dirty progress for a prestarted slice but rejects an unexpected HEAD', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--slice-title', 'First observable slice',
      '--remaining-obligations', JSON.stringify(['finish both files']),
      '--next-action', 'Continue implementation.',
      '--next-command', 'node --test focused.test.mjs'
    ).status, 0);
    await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 42;\n');
    assert.equal(control(repo, 'checkpoint').status, 0);
    await writeFile(path.join(repo, 'second.mjs'), 'export const second = true;\n');

    let result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let recovered = JSON.parse(result.stdout);
    assert.equal(recovered.recovery_status, 'RECONCILED_WORKTREE_CHANGE');
    assert.deepEqual(recovered.repository_state.touched_files, ['app.mjs', 'second.mjs']);
    assert.equal(recovered.current_slice.id, 'slice-1');

    assert.equal(run('git', ['add', 'app.mjs', 'second.mjs'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'unexpected interrupted commit'], repo).status, 0);
    result = control(repo, 'resume');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    recovered = JSON.parse(result.stdout);
    assert.equal(recovered.recovery_status, 'RECOVERY_RECONCILIATION_REQUIRED');
    assert.match(recovered.reconciliation_reason, /HEAD changed/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resume repairs a partial multi-file mutation using the newer canonical run revision', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--slice-title', 'First observable slice',
      '--remaining-obligations', JSON.stringify(['finish behavior'])
    ).status, 0);
    const runFile = runtimePath(repo, 'run.json');
    const state = await readJson(runFile);
    state.state_revision += 1;
    state.exact_next_action = 'Recover the interrupted canonical mutation.';
    state.exact_next_command = 'node --test recovery.test.mjs';
    await writeFile(runFile, `${JSON.stringify(state, null, 2)}\n`);

    const result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recovered = JSON.parse(result.stdout);
    assert.equal(recovered.recovery_status, 'RECONCILED_PARTIAL_MUTATION');
    assert.equal(recovered.run_state_revision, state.state_revision);
    assert.equal(recovered.exact_next_action, 'Recover the interrupted canonical mutation.');
    assert.equal(recovered.exact_next_command, 'node --test recovery.test.mjs');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('governed failure and a later correction survive two fresh-process resumes', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--slice-title', 'First observable slice',
      '--next-slice-id', 'slice-2',
      '--remaining-obligations', JSON.stringify(['pass focused test']),
      '--next-action', 'Run the focused test.',
      '--next-command', 'node --test focused.test.mjs'
    ).status, 0);
    await writeFile(path.join(repo, 'focused.test.mjs'), "throw new Error('expected fixture failure');\n");
    const plan = runtimePath(repo, 'failing-plan.json');
    await mkdir(path.dirname(plan), { recursive: true });
    await writeFile(plan, `${JSON.stringify({
      schema_version: 1,
      profile: 'focused-fixture',
      steps: [{
        id: 'focused',
        command: process.execPath,
        args: ['--test', 'focused.test.mjs']
      }]
    })}\n`);
    let result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', plan
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    const failureReceipt = JSON.parse(result.stdout);

    let checkpoint = await readJson(runtimePath(repo, 'checkpoints/current.json'));
    assert.equal(checkpoint.latest_meaningful_verification.receipt_id, failureReceipt.id);
    assert.equal(checkpoint.active_failure.receipt_id, failureReceipt.id);
    assert.equal(checkpoint.active_failure.step_id, 'focused');
    assert.match(checkpoint.active_failure.summary, /expected fixture failure|nonzero/i);
    assert.deepEqual(checkpoint.active_failure.command_argv, [process.execPath, '--test', 'focused.test.mjs']);

    result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).active_failure.receipt_id, failureReceipt.id);

    await writeFile(path.join(repo, 'focused.test.mjs'), "import test from 'node:test'; test('fixed', () => {});\n");
    result = control(
      repo,
      'checkpoint',
      '--status', 'awaiting_verification',
      '--corrections', JSON.stringify(['replaced failing fixture with a passing assertion']),
      '--next-action', 'Rerun the focused test.',
      '--next-command', 'node --test focused.test.mjs'
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recovered = JSON.parse(result.stdout);
    assert.equal(recovered.current_slice.status, 'awaiting_verification');
    assert.deepEqual(recovered.corrections_completed, [
      'replaced failing fixture with a passing assertion'
    ]);
    assert.equal(recovered.exact_next_command, 'node --test focused.test.mjs');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resume revalidates checkpoint evidence and exposes stale state during correction', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--remaining-obligations', JSON.stringify(['renew evidence after correction'])
    ).status, 0);
    let result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'),
      'record',
      '--kind', 'test',
      '--scope', 'focused',
      '--command', 'node --test focused.test.mjs',
      '--exit-code', '0',
      '--tests-passed', '1',
      '--tests-failed', '0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    result = control(
      repo,
      'checkpoint',
      '--evidence-receipts', JSON.stringify([{ id: receipt.id, status: 'valid' }]),
      '--next-action', 'Continue the correction.'
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 42;\n');

    result = control(repo, 'resume');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recovered = JSON.parse(result.stdout);
    assert.equal(recovered.evidence_receipts[0].id, receipt.id);
    assert.equal(recovered.evidence_receipts[0].status, 'stale');
    assert.match(recovered.evidence_receipts[0].invalidation_reason, /dirty tree changed/i);
    const summary = await readFile(runtimePath(repo, 'run.md'), 'utf8');
    assert.match(summary, new RegExp(`${receipt.id}.*stale`));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('slice completion requires current passing verification and advances to the distinct next slice', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--slice-title', 'First observable slice',
      '--next-slice-id', 'slice-2',
      '--next-slice-title', 'Second observable slice',
      '--remaining-obligations', JSON.stringify(['pass focused test']),
      '--next-action', 'Run the focused test.',
      '--next-command', 'node --test focused.test.mjs'
    ).status, 0);
    await writeFile(path.join(repo, 'focused.test.mjs'), "import test from 'node:test'; test('passes', () => {});\n");
    let result = control(repo, 'complete');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /passing verification|required|dirty/i);

    assert.equal(run('git', ['add', 'app.mjs', 'focused.test.mjs'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'complete slice 1'], repo).status, 0);
    const plan = runtimePath(repo, 'passing-plan.json');
    await writeFile(plan, `${JSON.stringify({
      schema_version: 1,
      profile: 'focused-fixture',
      steps: [{ id: 'focused', command: process.execPath, args: ['--test', 'focused.test.mjs'] }]
    })}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', plan
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);

    result = control(
      repo,
      'complete',
      '--verification-receipt', receipt.id,
      '--next-action', 'Start Slice 2 before editing.',
      '--next-command', 'node scripts/run-control.mjs start --slice-id slice-2'
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = await readJson(runtimePath(repo, 'run.json'));
    assert.equal(state.current_slice, null);
    assert.equal(state.completed_slices.at(-1).id, 'slice-1');
    assert.equal(state.completed_slices.at(-1).status, 'complete');
    assert.equal(state.next_slice.id, 'slice-2');
    assert.match(await readFile(runtimePath(repo, 'run.md'), 'utf8'), /Current slice[\s\S]*None[\s\S]*Next slice[\s\S]*slice-2/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('run summary drift is detected and deterministic refresh restores canonical bytes', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    const summaryPath = runtimePath(repo, 'run.md');
    const canonical = await readFile(summaryPath, 'utf8');
    await writeFile(summaryPath, `${canonical}\nmanual contradiction\n`);
    let result = control(repo, 'check');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /STALE_RUN_SUMMARY/);
    result = control(repo, 'refresh');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(summaryPath, 'utf8'), canonical);
    result = control(repo, 'refresh');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(summaryPath, 'utf8'), canonical);
    assert.equal(control(repo, 'check').status, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('legacy phase-checkpoint resume delegates to canonical recovery for a schema-3 run', async () => {
  const repo = await tempRepo();
  try {
    assert.equal(initRun(repo).status, 0);
    assert.equal(control(
      repo,
      'start',
      '--slice-id', 'slice-1',
      '--remaining-obligations', JSON.stringify(['finish behavior']),
      '--next-action', 'Continue the current slice.'
    ).status, 0);
    await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 42;\n');
    const result = run(process.execPath, [
      path.join(root, 'scripts/phase-checkpoint.mjs'), 'resume'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recovered = JSON.parse(result.stdout);
    assert.equal(recovered.current_slice.id, 'slice-1');
    assert.equal(recovered.recovery_status, 'RECONCILED_WORKTREE_CHANGE');
    assert.deepEqual(recovered.repository_state.touched_files, ['app.mjs']);

    const legacyInput = path.join(repo, 'legacy-checkpoint.json');
    await writeFile(legacyInput, `${JSON.stringify({
      mission_digest: 'legacy',
      invariants_and_non_goals: [],
      current_architecture: [],
      completed_slice_commits: [],
      evidence_receipts: [],
      open_findings: [],
      unavailable_evidence: [],
      exact_next_slice: 'slice-2',
      relevant_files_and_interfaces: [],
      budget_position: {}
    })}\n`);
    const rejected = run(process.execPath, [
      path.join(root, 'scripts/phase-checkpoint.mjs'),
      'create', '--input', legacyInput
    ], repo);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /run-control.*checkpoint|schema-3/i);
    assert.equal((await readJson(runtimePath(repo, 'checkpoints/current.json'))).schema_version, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('legacy 0.7.0 dirty state preserves history and reports recovery ambiguity instead of inventing a current slice', async () => {
  const repo = await tempRepo();
  try {
    const runtime = runtimePath(repo);
    await mkdir(path.join(runtime, 'checkpoints'), { recursive: true });
    await writeFile(path.join(runtime, 'run.json'), `${JSON.stringify({
      schema_version: 2,
      id: 'legacy-run',
      root_actor_id: 'root',
      started_at: '2026-01-01T00:00:00.000Z',
      starting_head: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
      plan: { id: 'legacy-plan', source: 'legacy-source' },
      decisions: [{ id: 'preserve-me' }],
      slice_commits: [],
      evidence: [],
      verifications: [],
      unresolved_risks: [],
      legacy_unknown: { must_survive: true }
    }, null, 2)}\n`);
    await writeFile(path.join(runtime, 'checkpoints/current.json'), `${JSON.stringify({
      schema_version: 1,
      mission_digest: 'legacy-mission',
      invariants_and_non_goals: [],
      current_architecture: [],
      completed_slice_commits: [],
      evidence_receipts: [],
      open_findings: [],
      unavailable_evidence: [],
      exact_next_slice: 'Slice 5',
      relevant_files_and_interfaces: ['app.mjs'],
      budget_position: {},
      legacy_checkpoint_unknown: 'preserve-me'
    }, null, 2)}\n`);
    await writeFile(path.join(repo, 'app.mjs'), 'export const answer = 42;\n');

    const result = control(repo, 'resume');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /RECOVERY_RECONCILIATION_REQUIRED/);
    const state = await readJson(path.join(runtime, 'run.json'));
    assert.equal(state.schema_version, 3);
    assert.equal(state.current_slice, null);
    assert.equal(state.next_slice.id, 'Slice 5');
    assert.equal(state.legacy_unknown.must_survive, true);
    assert.equal(state.migration.status, 'recovery_reconciliation_required');
    const checkpoint = await readJson(path.join(runtime, 'checkpoints/current.json'));
    assert.equal(checkpoint.legacy_checkpoint_unknown, 'preserve-me');
    assert.equal(checkpoint.recovery_status, 'RECOVERY_RECONCILIATION_REQUIRED');
    assert.deepEqual(checkpoint.repository_state.touched_files, ['app.mjs']);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
