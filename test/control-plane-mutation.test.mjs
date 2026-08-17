import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import { withControlPlaneMutation } from '../scripts/lib/control-plane-mutation.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function runtimePath(repo, ...parts) {
  return path.join(run('git', [
    'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
  ], repo).stdout.trim(), ...parts);
}

async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-control-mutation-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'candidate'], repo).status, 0);
  let result = run(process.execPath, [
    path.join(root, 'scripts/init-run.mjs'),
    '--profile', 'high-risk', '--reason', 'control mutation fixture'
  ], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = run(process.execPath, [
    path.join(root, 'scripts/run-control.mjs'), 'start',
    '--slice-id', 'slice-1', '--remaining-obligations', '["finish"]'
  ], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { repo, runtime: runtimePath(repo) };
}

test('a successful canonical mutation synchronizes revision, checkpoint, audit, and run.md', async () => {
  const { repo, runtime } = await fixture();
  try {
    const before = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    const budgetFile = path.join(runtime, 'budget.json');
    const result = await withControlPlaneMutation(runtime, repo, {
      mutationType: 'budget_test_transition'
    }, async () => {
      const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
      budget.usage.correction_commits = 1;
      await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
      return { status: 'BUDGET_OK' };
    });
    assert.equal(result.status, 'BUDGET_OK');

    const after = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    const checkpoint = JSON.parse(await readFile(
      path.join(runtime, 'checkpoints', 'current.json'),
      'utf8'
    ));
    assert.equal(after.state_revision, before.state_revision + 1);
    assert.equal(checkpoint.run_state_revision, after.state_revision);
    assert.equal(checkpoint.budget_position.usage.correction_commits, 1);
    const events = (await readFile(path.join(runtime, 'events', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    const started = events.findLast(({ event_type }) =>
      event_type === 'control_plane_mutation_started'
    );
    const completed = events.findLast(({ event_type }) =>
      event_type === 'control_plane_mutation_completed'
    );
    assert.equal(started.transaction_id, completed.transaction_id);
    await assert.rejects(readFile(path.join(runtime, 'transactions', 'current.json')), /ENOENT/);
    const check = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'check'
    ], repo);
    assert.equal(check.status, 0, check.stderr || check.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a declared non-atomic multi-store failure retains its resumable transaction marker', async () => {
  const { repo, runtime } = await fixture();
  try {
    await assert.rejects(withControlPlaneMutation(runtime, repo, {
      mutationType: 'multi_store_test_transition',
      atomicFailure: false
    }, async () => {
      await writeFile(path.join(runtime, 'first-store.json'), '{"written":true}\n');
      throw new Error('second store failed');
    }), /second store failed/);
    const transaction = JSON.parse(await readFile(
      path.join(runtime, 'transactions', 'current.json'),
      'utf8'
    ));
    assert.equal(transaction.phase, 'started');
    assert.equal(transaction.mutation_type, 'multi_store_test_transition');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('fresh-process resume finishes a mutation interrupted after its canonical write', async () => {
  const { repo, runtime } = await fixture();
  try {
    const state = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    const budgetFile = path.join(runtime, 'budget.json');
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.usage.correction_commits = 1;
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
    await mkdir(path.join(runtime, 'transactions'), { recursive: true });
    await writeFile(path.join(runtime, 'transactions', 'current.json'), `${JSON.stringify({
      schema_version: 1,
      transaction_id: 'interrupted-transaction',
      mutation_type: 'budget_test_transition',
      actor_id: 'root',
      phase: 'canonical_mutation_applied',
      run_state_revision_before: state.state_revision,
      candidate_before: {
        head: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
        tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
        dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      started_at: '2026-08-16T00:00:00.000Z',
      canonical_mutation_applied_at: '2026-08-16T00:00:01.000Z'
    }, null, 2)}\n`);
    await writeFile(path.join(runtime, 'run.md'), '# stale after interruption\n');

    let result = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'resume'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resumed = JSON.parse(result.stdout);
    assert.equal(resumed.recovery_status, 'RECONCILED_CONTROL_PLANE_MUTATION');
    assert.equal(resumed.budget_position.usage.correction_commits, 1);
    assert.equal(resumed.run_state_revision, state.state_revision + 1);
    await assert.rejects(readFile(path.join(runtime, 'transactions', 'current.json')), /ENOENT/);
    result = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'check'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resume exposes an ambiguous pre-commit mutation without claiming success', async () => {
  const { repo, runtime } = await fixture();
  try {
    const state = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    await mkdir(path.join(runtime, 'transactions'), { recursive: true });
    await writeFile(path.join(runtime, 'transactions', 'current.json'), `${JSON.stringify({
      schema_version: 1,
      transaction_id: 'ambiguous-transaction',
      mutation_type: 'evidence_recorded',
      actor_id: 'root',
      phase: 'started',
      run_state_revision_before: state.state_revision,
      candidate_before: {
        head: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
        tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
        dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      started_at: '2026-08-16T00:00:00.000Z'
    }, null, 2)}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'resume'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const checkpoint = JSON.parse(result.stdout);
    assert.equal(checkpoint.recovery_status, 'RECOVERY_RECONCILIATION_REQUIRED');
    assert.equal(checkpoint.active_transaction.transaction_id, 'ambiguous-transaction');
    assert.equal(checkpoint.run_state_revision, state.state_revision);
    assert.match(await readFile(path.join(runtime, 'run.md'), 'utf8'), /ambiguous-transaction/);
    assert.equal(JSON.parse(await readFile(
      path.join(runtime, 'transactions', 'current.json'), 'utf8'
    )).phase, 'started');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('an explicitly evidenced no-op reconciliation archives a pre-write transaction', async () => {
  const { repo, runtime } = await fixture();
  try {
    const state = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    const tree = run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim();
    await mkdir(path.join(runtime, 'transactions'), { recursive: true });
    await writeFile(path.join(runtime, 'transactions', 'current.json'), `${JSON.stringify({
      schema_version: 1,
      transaction_id: 'rejected-verdict',
      mutation_type: 'review_verdict_recorded',
      actor_id: 'root',
      phase: 'started',
      run_state_revision_before: state.state_revision,
      candidate_before: {
        head, tree,
        dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      started_at: '2026-08-16T00:00:00.000Z'
    }, null, 2)}\n`);
    await writeFile(path.join(repo, 'tracked.txt'), 'work continued after the rejected command\n');

    let result = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'reconcile',
      '--transaction-id', 'rejected-verdict',
      '--disposition', 'no_canonical_mutation',
      '--reason', 'CLI validation rejected the verdict before lifecycle mutation.',
      '--evidence', 'review lifecycle attempt remains active with verdict null'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'TRANSACTION_RECONCILED_NOOP');
    await assert.rejects(readFile(path.join(runtime, 'transactions', 'current.json')), /ENOENT/);
    const archived = JSON.parse(await readFile(
      path.join(runtime, 'transactions', 'reconciled', 'rejected-verdict.json'),
      'utf8'
    ));
    assert.equal(archived.phase, 'reconciled_no_canonical_mutation');
    assert.match(archived.reconciliation_reason, /validation rejected/i);
    assert.deepEqual(archived.reconciliation_evidence, [
      'review lifecycle attempt remains active with verdict null'
    ]);
    assert.equal(archived.candidate_changed_during_reconciliation, true);
    assert.notEqual(
      archived.candidate_at_reconciliation.dirty_tree_fingerprint,
      archived.candidate_before.dirty_tree_fingerprint
    );
    const after = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    assert.equal(after.state_revision, state.state_revision + 1);
    result = run(process.execPath, [path.join(root, 'scripts/run-control.mjs'), 'check'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence, budget, review, delegation, and convergence CLIs share one mutation boundary', async () => {
  const { repo, runtime } = await fixture();
  try {
    const revision = async () => JSON.parse(
      await readFile(path.join(runtime, 'run.json'), 'utf8')
    ).state_revision;
    let before = await revision();
    let result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'record',
      '--kind', 'test', '--scope', 'focused', '--command', 'focused fixture',
      '--exit-code', '0', '--test-discovery', 'tests_executed', '--tests-passed', '1'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(await revision(), before + 1);
    let checkpoint = JSON.parse(await readFile(
      path.join(runtime, 'checkpoints', 'current.json'), 'utf8'
    ));
    assert.deepEqual(checkpoint.evidence_receipts, [{ id: receipt.id, status: 'valid' }]);

    before = await revision();
    result = run(process.execPath, [
      path.join(root, 'scripts/run-budget.mjs'), 'record',
      '--metric', 'correction_commits', '--amount', '1'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await revision(), before + 1);
    checkpoint = JSON.parse(await readFile(
      path.join(runtime, 'checkpoints', 'current.json'), 'utf8'
    ));
    assert.equal(checkpoint.budget_position.usage.correction_commits, 1);

    const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    const tree = run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim();
    before = await revision();
    result = run(process.execPath, [
      path.join(root, 'scripts/review-lifecycle.mjs'), 'init',
      '--seam-id', 'whole-release', '--reviewer-identity', 'reviewer-1',
      '--base', head, '--head', head, '--tree', tree,
      '--dirty-tree-fingerprint', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '--semantic-contract-sha256', 'e'.repeat(64)
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await revision(), before + 1);
    checkpoint = JSON.parse(await readFile(
      path.join(runtime, 'checkpoints', 'current.json'), 'utf8'
    ));
    assert.equal(checkpoint.review_position.status, 'initial_review_required');

    before = await revision();
    result = run(process.execPath, [
      path.join(root, 'scripts/delegation-record.mjs'), 'decide',
      '--selected', 'false', '--reason', 'Inline is cheaper',
      '--inline-assessment', 'No bounded parallel role improves this fixture'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const delegation = JSON.parse(result.stdout);
    assert.equal(await revision(), before + 1);

    before = await revision();
    result = run(process.execPath, [
      path.join(root, 'scripts/convergence.mjs'), 'decide',
      '--event', 'focused failure', '--scope', 'in-scope',
      '--sensitivity', 'ordinary', '--reversible', 'true',
      '--authorized', 'true', '--deterministic', 'true', '--locality', 'local',
      '--metric', 'correction_commits'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const convergence = JSON.parse(result.stdout);
    assert.equal(await revision(), before + 1);
    const summary = await readFile(path.join(runtime, 'run.md'), 'utf8');
    assert.match(summary, new RegExp(delegation.id));
    assert.match(summary, new RegExp(convergence.id));
    result = run(process.execPath, [
      path.join(root, 'scripts/run-control.mjs'), 'check'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('optional delegation fails closed when governed execution accounting is stale', async () => {
  const { repo, runtime } = await fixture();
  try {
    const budgetFile = path.join(runtime, 'budget.json');
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.usage.complete_suite_executions = 1;
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/delegation-record.mjs'), 'decide',
      '--selected', 'true', '--reason', 'Try an optional role',
      '--inline-assessment', 'Parallel work might help', '--role', 'researcher',
      '--ownership', 'bounded topic', '--tool-restrictions', 'read-only',
      '--dependency-cone', 'docs', '--stop-condition', 'report once',
      '--acceptance-proof', 'owner inspection'
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /STALE_ACCOUNTING/i);
    await assert.rejects(
      readFile(path.join(runtime, 'delegation', 'decisions.jsonl'), 'utf8'),
      /ENOENT/
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
