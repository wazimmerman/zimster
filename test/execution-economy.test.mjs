import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  analyzeExecutionBudgetProofIdentities,
  correctionRecheckEpochIssues
} from '../scripts/lib/execution-budget.mjs';

const execFileAsync = promisify(execFile);

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-economy-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

function runtimePath(repo, relative) {
  return run(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', `zimster/${relative}`],
    repo
  ).stdout.trim();
}

function checkpointInput(overrides = {}) {
  return {
    mission_digest: 'Reduce deterministic execution overhead without weakening evidence.',
    invariants_and_non_goals: [
      'One logical implementation owner',
      'Do not push, merge, tag, or modify main'
    ],
    current_architecture: [
      'Git-local operational state',
      'Canonical source with generated Codex mirror'
    ],
    completed_slice_commits: ['0123456789abcdef0123456789abcdef01234567'],
    evidence_receipts: [{ id: 'receipt-valid', status: 'valid' }],
    open_findings: ['Installed-package smoke remains pending'],
    unavailable_evidence: [],
    exact_next_slice: 'Implement tree-keyed evidence reuse',
    relevant_files_and_interfaces: [
      'scripts/evidence.mjs',
      'scripts/lib/git-state.mjs',
      'test/execution-economy.test.mjs'
    ],
    budget_position: {
      complete_suite_executions: 0,
      context_compactions: 1
    },
    ...overrides
  };
}

test('execution budget refuses an over-limit event without an invalidation or strategy change', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /BUDGET_CONSTRAINED/,
      JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr })
    );

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.complete_suite_executions, 0);
    assert.equal(state.overrides.length, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('execution budget warns at a limit without discarding required evidence', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'high-risk'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '3'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'BUDGET_WARNING');
    assert.equal(summary.value, 3);
    assert.equal(summary.limit, 3);

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.complete_suite_executions, 3);
    assert.deepEqual(state.proof_obligations, []);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('execution budget accepts an over-limit strategy change only with a required proof', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const planFile = runtimePath(repo, 'proof-plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'release',
      complete_suite: false,
      steps: [{
        id: 'proof',
        command: process.execPath,
        args: ['-e', 'process.exit(0);']
      }]
    })}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const releaseReceipt = JSON.parse(result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'split final gate after reviewer invalidation'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /BUDGET_PROOF_REQUIRED/);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'split final gate after reviewer invalidation',
      '--required-proof', 'release:verify receipt',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'release'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'BUDGET_OVERRIDE');

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.complete_suite_executions, 4);
    assert.equal(state.overrides.length, 1);
    assert.equal(state.overrides[0].strategy_change, 'split final gate after reviewer invalidation');
    assert.equal(state.proof_obligations[0].proof, 'release:verify receipt');
    assert.equal(state.proof_obligations[0].status, 'required');
    assert.equal(state.proof_obligations[0].metric, 'complete_suite_executions');
    assert.equal(state.proof_obligations[0].receipt_type, 'verification');
    assert.equal(state.proof_obligations[0].profile, 'release');
    assert.match(state.proof_obligations[0].required_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      state.proof_obligations[0].relationship,
      'trusted_governed_receipt_must_precede_obligation'
    );

    const receiptDirectory = runtimePath(repo, 'verification/receipts');
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(path.join(receiptDirectory, 'proof-receipt.json'), `${JSON.stringify({
      id: 'proof-receipt',
      status: 'passed',
      profile: 'goal',
      git_commit: run('git', ['rev-parse', 'HEAD'], repo).stdout.trim(),
      git_tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
      dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      environment: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        node: process.version
      }
    })}\n`);
    result = run(process.execPath, [
      budget, 'prove', '--proof', 'release:verify receipt', '--receipt', 'proof-receipt'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /profile|relationship|release/i);
    await writeFile(path.join(repo, 'tracked.txt'), 'dirty after proof\n');
    result = run(process.execPath, [
      budget, 'prove', '--proof', 'release:verify receipt', '--receipt', releaseReceipt.id
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /dirty|tree|fresh|current/i);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    result = run(process.execPath, [
      budget, 'prove', '--proof', 'release:verify receipt', '--receipt', releaseReceipt.id
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'BUDGET_PROOF_SATISFIED');
    const proven = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(proven.proof_obligations[0].status, 'satisfied');
    assert.equal(proven.proof_obligations[0].receipt_id, releaseReceipt.id);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('budget proof satisfaction rejects an explicitly invalidated evidence receipt', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const proofArgv = [process.execPath, '-e', 'process.exit(0);'];
    const proofCommand = proofArgv.join(' ');
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'test', '--scope', 'affected', '--', ...proofArgv
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'review correction',
      '--required-proof', 'affected correction tests',
      '--required-proof-type', 'evidence',
      '--required-proof-kind', 'test',
      '--required-proof-scope', 'affected',
      '--required-proof-command', proofCommand
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      evidence, 'invalidate', '--id', receipt.id, '--reason', 'review found stale proof'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      budget, 'prove', '--proof', 'affected correction tests', '--receipt', receipt.id
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /invalidated|trusted governed receipt|current-tree/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('budget proof satisfaction rejects reusable evidence from a different candidate tree', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const proofArgv = [process.execPath, '-e', 'process.exit(0);'];
    const proofCommand = proofArgv.join(' ');
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'test', '--scope', 'affected',
      '--dependencies', 'tracked.txt', '--', ...proofArgv
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'review correction',
      '--required-proof', 'exact candidate correction tests',
      '--required-proof-type', 'evidence',
      '--required-proof-kind', 'test',
      '--required-proof-scope', 'affected',
      '--required-proof-command', proofCommand
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(path.join(repo, 'unrelated.txt'), 'later candidate\n');
    assert.equal(run('git', ['add', 'unrelated.txt'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'later candidate'], repo).status, 0);
    result = run(process.execPath, [evidence, 'check', '--id', receipt.id], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'prove', '--proof', 'exact candidate correction tests', '--receipt', receipt.id
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /exact candidate|current-tree|passing receipt/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a circular budget proof can only be superseded by an auditable enforceable replacement', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'final review invalidated the original sequencing',
      '--required-proof', 'circular release receipt',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'release'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const evidence = path.join(root, 'scripts/evidence.mjs');
    const proofArgv = [process.execPath, '-e', 'process.exit(0);'];
    const proofCommand = proofArgv.join(' ');
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'test', '--scope', 'focused', '--', ...proofArgv
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);

    result = run(process.execPath, [
      budget, 'supersede',
      '--proof', 'circular release receipt',
      '--replacement-proof', 'focused budget regression',
      '--reason', 'The release receipt depends on the approval that the proof must precede.',
      '--required-proof-type', 'evidence',
      '--required-proof-kind', 'test',
      '--required-proof-scope', 'focused',
      '--required-proof-command', proofCommand
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'BUDGET_PROOF_SUPERSEDED');
    let state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.proof_obligations[0].status, 'superseded');
    assert.equal(state.proof_obligations[0].superseded_by, 'focused budget regression');
    assert.equal(state.proof_obligations[1].status, 'required');

    result = run(process.execPath, [
      budget, 'prove', '--proof', 'circular release receipt', '--receipt', 'missing'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'prove', '--proof', 'focused budget regression', '--receipt', receipt.id
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.proof_obligations[0].status, 'superseded');
    assert.equal(state.proof_obligations[1].status, 'satisfied');
    assert.equal(state.proof_obligations[1].receipt_id, receipt.id);

    result = run(process.execPath, [
      budget, 'supersede',
      '--proof', 'focused budget regression',
      '--replacement-proof', 'refreshed exact candidate proof',
      '--reason', 'The candidate changed after the prior proof was satisfied.',
      '--required-proof-type', 'evidence',
      '--required-proof-kind', 'test',
      '--required-proof-scope', 'focused',
      '--required-proof-command', proofCommand
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.proof_obligations[1].status, 'superseded');
    assert.equal(state.proof_obligations[1].receipt_id, receipt.id);
    assert.equal(state.proof_obligations[1].superseded_by, 'refreshed exact candidate proof');
    assert.equal(state.proof_obligations[2].status, 'required');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a stable proof identity cannot be reused after it is satisfied', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proofArgv = [process.execPath, '-e', 'process.exit(0);'];
    const proofCommand = proofArgv.join(' ');
    result = run(process.execPath, [
      evidence, 'run', '--kind', 'test', '--scope', 'focused', '--', ...proofArgv
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const proofOptions = [
      '--required-proof', 'immutable-proof-id',
      '--required-proof-type', 'evidence',
      '--required-proof-kind', 'test',
      '--required-proof-scope', 'focused',
      '--required-proof-command', proofCommand
    ];
    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '4',
      '--strategy-change', 'first override', ...proofOptions
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      budget, 'prove', '--proof', 'immutable-proof-id', '--receipt', receipt.id
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'correction_commits', '--amount', '3',
      '--strategy-change', 'second override', ...proofOptions
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /proof identity.*already exists|globally unique/i);
    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.proof_obligations.filter(({ proof }) =>
      proof === 'immutable-proof-id').length, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('historical duplicate proof labels require explicit occurrence-bound reconciliation', async () => {
  const repo = await tempRepo();
  try {
    const budgetCommand = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budgetCommand, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const budgetFile = runtimePath(repo, 'budget.json');
    const state = JSON.parse(await readFile(budgetFile, 'utf8'));
    state.overrides = [{ required_proof: 'legacy-duplicate' }];
    state.proof_obligations = [{
      proof: 'legacy-duplicate', status: 'superseded', superseded_by: 'replacement-a',
      supersession_reason: 'first chain', superseded_at: '2026-08-16T00:00:01.000Z'
    }, {
      proof: 'replacement-a', status: 'satisfied', receipt_id: 'receipt-a'
    }, {
      proof: 'earlier-source', status: 'superseded', superseded_by: 'legacy-duplicate',
      supersession_reason: 'historical link', superseded_at: '2026-08-16T00:00:02.000Z'
    }, {
      proof: 'legacy-duplicate', status: 'superseded', superseded_by: 'replacement-b',
      supersession_reason: 'second chain', superseded_at: '2026-08-16T00:00:03.000Z'
    }, {
      proof: 'replacement-b', status: 'satisfied', receipt_id: 'receipt-b'
    }];
    await writeFile(budgetFile, `${JSON.stringify(state, null, 2)}\n`);
    assert.match(
      analyzeExecutionBudgetProofIdentities(state).issues.join('\n'),
      /duplicate proof identity.*legacy-duplicate/i
    );
    result = run(process.execPath, [
      budgetCommand, 'reconcile-identities',
      '--proof', 'legacy-duplicate',
      '--bindings', JSON.stringify([
        { source_type: 'override', source_index: 0, target_occurrence: 1 },
        { source_type: 'supersession', source_index: 2, target_occurrence: 0 }
      ]),
      '--reason', 'Bind the preserved historical duplicate occurrences without rewriting them.'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reconciled = JSON.parse(await readFile(budgetFile, 'utf8'));
    const analysis = analyzeExecutionBudgetProofIdentities(reconciled);
    analysis.resolve('legacy-duplicate', 'override', 0);
    analysis.resolve('legacy-duplicate', 'supersession', 2);
    assert.deepEqual(analysis.issues, []);
    assert.equal(reconciled.proof_obligations[0].proof, 'legacy-duplicate');
    assert.equal(reconciled.proof_obligations[3].proof, 'legacy-duplicate');
    assert.equal(reconciled.proof_identity_reconciliations.length, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('execution budget counts optional agent identities once and scopes review rechecks by seam', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const agentId of ['scout-1', 'scout-1', 'reviewer-1']) {
      result = run(process.execPath, [
        budget, 'record', '--metric', 'optional_deliberate_agents', '--agent-id', agentId
      ], repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    for (const seam of ['runtime', 'release']) {
      result = run(process.execPath, [
        budget, 'record', '--metric', 'review_rechecks_per_seam', '--scope', seam
      ], repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    result = run(process.execPath, [
      budget, 'record', '--metric', 'review_rechecks_per_seam', '--scope', 'runtime'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.deepEqual(state.optional_agent_identities, ['scout-1', 'reviewer-1']);
    assert.equal(state.usage.optional_deliberate_agents, 2);
    assert.equal(state.scoped_usage.review_rechecks_per_seam.runtime, 1);
    assert.equal(state.scoped_usage.review_rechecks_per_seam.release, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a material semantic lifecycle reset authorizes a fresh seam-epoch recheck without weakening the seam guard', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'correction_rechecks', '--scope', 'whole-release'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const semanticContract = 'b'.repeat(64);
    const lifecycleDirectory = runtimePath(repo, 'review-lifecycle');
    await mkdir(lifecycleDirectory, { recursive: true });
    await writeFile(path.join(lifecycleDirectory, 'whole-release.json'), `${JSON.stringify({
      schema_version: 1,
      seam_id: 'whole-release',
      status: 'correction_recheck_required',
      candidate: { semantic_contract_sha256: semanticContract }
    })}\n`);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'correction_rechecks', '--scope', 'whole-release',
      '--semantic-contract-sha256', 'c'.repeat(64)
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /current lifecycle semantic contract/i);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'correction_rechecks', '--scope', 'whole-release',
      '--semantic-contract-sha256', semanticContract
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.correction_rechecks, 2);
    assert.equal(state.scoped_usage.correction_rechecks['whole-release'], 1);
    assert.equal(
      state.scoped_usage.correction_rechecks[`whole-release@${semanticContract}`],
      1
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('completion budget accounting reconciles aggregate historical rechecks through authenticated semantic epochs', () => {
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  const third = 'c'.repeat(64);
  const lifecycle = {
    seam_id: 'whole-release',
    attempts: [first, second, third].map((semantic, index) => ({
      attempt_type: 'correction_recheck',
      attempt_id: `recheck-${index + 1}`,
      seam_id: 'whole-release',
      candidate: { semantic_contract_sha256: semantic }
    }))
  };
  const budget = {
    usage: { correction_rechecks: 3 },
    scoped_usage: {
      correction_rechecks: {
        'whole-release': 2,
        [`whole-release@${third}`]: 1
      }
    }
  };
  assert.deepEqual(correctionRecheckEpochIssues(budget, lifecycle), []);

  const replayed = structuredClone(lifecycle);
  replayed.attempts[2].candidate.semantic_contract_sha256 = second;
  assert.match(
    correctionRecheckEpochIssues(budget, replayed).join('\n'),
    /more than one correction recheck/i
  );
});

test('run initialization creates a machine-readable budget for Standard and High-risk profiles', async () => {
  for (const profile of ['standard', 'high-risk']) {
    const repo = await tempRepo();
    try {
      const result = run(process.execPath, [
        path.join(root, 'scripts/init-run.mjs'), '--profile', profile, '--harness', 'codex'
      ], repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
      assert.equal(state.profile, profile);
      assert.equal(state.limits.complete_suite_executions, 3);
      assert.equal(state.limits.exact_duplicate_commands, 2);
      assert.equal(state.limits.context_compactions, 2);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
});

test('phase checkpoint produces a bounded resumption payload from required compact fields', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'test', '--scope', 'focused',
      '--command', 'node --test', '--exit-code', '0',
      '--tests-passed', '1', '--tests-failed', '0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const input = checkpointInput({
      evidence_receipts: [{ id: receipt.id, status: 'valid' }]
    });
    const inputFile = runtimePath(repo, 'checkpoint-input.json');
    await writeFile(inputFile, `${JSON.stringify(input)}\n`);
    const checkpoint = path.join(root, 'scripts/phase-checkpoint.mjs');

    result = run(process.execPath, [
      checkpoint, 'create', '--input', inputFile, '--max-bytes', '4096'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'CHECKPOINT_CREATED');
    assert.ok(summary.bytes <= 4096);

    result = run(process.execPath, [checkpoint, 'resume'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resumed = JSON.parse(result.stdout);
    assert.equal(resumed.exact_next_slice, input.exact_next_slice);
    assert.deepEqual(resumed.relevant_files_and_interfaces, input.relevant_files_and_interfaces);
    assert.deepEqual(resumed.budget_position, input.budget_position);
    assert.equal(Object.hasOwn(resumed, 'logs'), false);
    assert.equal(Object.hasOwn(resumed, 'objective'), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('phase checkpoint accepts a current deterministic-verification receipt', async () => {
  const repo = await tempRepo();
  try {
    const planFile = runtimePath(repo, 'checkpoint-verification-plan.json');
    await mkdir(path.dirname(planFile), { recursive: true });
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'checkpoint-fixture',
      steps: [{
        id: 'passes',
        command: process.execPath,
        args: ['-e', 'process.exit(0);']
      }]
    })}\n`);
    let result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const inputFile = runtimePath(repo, 'checkpoint-input.json');
    await writeFile(inputFile, `${JSON.stringify(checkpointInput({
      evidence_receipts: [{ id: receipt.id, status: 'valid' }]
    }))}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/phase-checkpoint.mjs'), 'create', '--input', inputFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      path.join(root, 'scripts/phase-checkpoint.mjs'), 'resume'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).evidence_receipts, [{
      id: receipt.id,
      status: 'valid'
    }]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('phase checkpoint rejects verbose context and duplicated objective payloads', async () => {
  for (const forbidden of [
    { objective: 'the complete objective repeated here' },
    { passing_logs: ['all passing test names and output'] },
    { prior_diffs: 'a complete historical diff' },
    { transcript: 'the full owner transcript' },
    { mission_digest: 'x'.repeat(513) }
  ]) {
    const repo = await tempRepo();
    try {
      const inputFile = path.join(repo, 'checkpoint-input.json');
      await writeFile(inputFile, `${JSON.stringify(checkpointInput(forbidden))}\n`);
      const result = run(process.execPath, [
        path.join(root, 'scripts/phase-checkpoint.mjs'),
        'create', '--input', inputFile, '--max-bytes', '4096'
      ], repo);
      assert.notEqual(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /forbidden|mission_digest.*512|verbose|objective/i);
      await assert.rejects(readFile(runtimePath(repo, 'checkpoints/current.json'), 'utf8'), /ENOENT/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
});

test('phase checkpoint preserves stale evidence references only with an invalidation reason', async () => {
  const repo = await tempRepo();
  try {
    const inputFile = path.join(repo, 'checkpoint-input.json');
    const checkpoint = path.join(root, 'scripts/phase-checkpoint.mjs');
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'test', '--scope', 'focused',
      '--command', 'node --test', '--exit-code', '0',
      '--tests-passed', '1', '--tests-failed', '0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    result = run(process.execPath, [
      evidence, 'invalidate', '--id', receipt.id, '--reason', 'dependency cone changed'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(inputFile, `${JSON.stringify(checkpointInput({
      evidence_receipts: [{ id: receipt.id, status: 'stale' }]
    }))}\n`);
    result = run(process.execPath, [
      checkpoint, 'create', '--input', inputFile
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /stale.*invalidation_reason/i);

    await writeFile(inputFile, `${JSON.stringify(checkpointInput({
      evidence_receipts: [{
        id: receipt.id,
        status: 'stale',
        invalidation_reason: 'dependency cone changed'
      }]
    }))}\n`);
    result = run(process.execPath, [checkpoint, 'create', '--input', inputFile], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [checkpoint, 'resume'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).evidence_receipts, [{
      id: receipt.id,
      status: 'stale',
      invalidation_reason: 'dependency cone changed'
    }]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence reuse survives an unrelated committed change but not dirty-tree or dependency drift', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'test', '--scope', 'affected',
      '--command', 'node --test tracked.test.mjs', '--exit-code', '0',
      '--tests-passed', '1', '--tests-failed', '0',
      '--dependencies', 'tracked.txt'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.match(receipt.git_commit, /^[0-9a-f]{40}$/);
    assert.match(receipt.git_tree, /^[0-9a-f]{40}$/);
    assert.match(receipt.dirty_tree_fingerprint, /^[0-9a-f]{64}$/);
    assert.match(receipt.environment_fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(receipt.dependency_fingerprints.map(({ input }) => input), ['tracked.txt']);

    await writeFile(path.join(repo, 'notes.md'), 'provenance-only change\n');
    assert.equal(run('git', ['add', 'notes.md'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'docs only'], repo).status, 0);
    result = run(process.execPath, [
      evidence, 'find', '--kind', 'test', '--scope', 'affected',
      '--command', 'node --test tracked.test.mjs', '--dependencies', 'tracked.txt'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /REUSABLE_DUPLICATE/);

    await writeFile(path.join(repo, 'unrelated.tmp'), 'dirty\n');
    result = run(process.execPath, [
      evidence, 'find', '--kind', 'test', '--scope', 'affected',
      '--command', 'node --test tracked.test.mjs', '--dependencies', 'tracked.txt'
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);

    await rm(path.join(repo, 'unrelated.tmp'));
    await writeFile(path.join(repo, 'tracked.txt'), 'dependency changed\n');
    result = run(process.execPath, [
      evidence, 'find', '--kind', 'test', '--scope', 'affected',
      '--command', 'node --test tracked.test.mjs', '--dependencies', 'tracked.txt'
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('final-gate evidence is always fresh even when an otherwise reusable receipt exists', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'verification', '--scope', 'complete',
      '--command', 'npm run goal:verify', '--exit-code', '0', '--final'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'verification', '--scope', 'complete',
      '--command', 'npm run goal:verify', '--final'
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /NO_REUSABLE_EVIDENCE/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('explicit reviewer invalidation prevents evidence reuse and preserves the reason', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'integration', '--scope', 'affected',
      '--command', 'npm run validate', '--exit-code', '0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);

    result = run(process.execPath, [
      evidence, 'invalidate', '--id', receipt.id,
      '--reason', 'reviewer found stale generated mirror'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invalidation = JSON.parse(result.stdout);
    assert.equal(invalidation.receipt_id, receipt.id);
    assert.equal(invalidation.reason, 'reviewer found stale generated mirror');

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'integration', '--scope', 'affected',
      '--command', 'npm run validate'
    ], repo);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /NO_REUSABLE_EVIDENCE/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('forced duplicate governed execution increments the initialized run budget', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    const evidence = path.join(root, 'scripts/evidence.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused',
      '--', process.execPath, '-e', 'process.exit(0);'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused', '--force',
      '--', process.execPath, '-e', 'process.exit(0);'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.exact_duplicate_commands, 1);
    assert.equal(state.events.at(-1).metric, 'exact_duplicate_commands');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('execution budget tracks a declared token threshold only when telemetry is recorded', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [
      budget, 'init', '--profile', 'standard', '--token-threshold', '1000'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      budget, 'record', '--metric', 'observed_tokens', '--amount', '600'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.limits.observed_tokens, 1000);
    assert.equal(state.usage.observed_tokens, 600);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('unforced reusable evidence blocks command execution instead of silently repeating it', async () => {
  const repo = await tempRepo();
  const external = await mkdtemp(path.join(os.tmpdir(), 'zimster-dedup-marker-'));
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const runner = path.join(repo, 'runner.mjs');
    const marker = path.join(external, 'ran.txt');
    await writeFile(
      runner,
      "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'ran\\n');\n"
    );

    let result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused',
      '--', process.execPath, runner, marker
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await rm(marker);

    result = run(process.execPath, [
      evidence, 'run', '--kind', 'command', '--scope', 'focused',
      '--', process.execPath, runner, marker
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout + result.stderr, /REUSABLE|duplicate/i);
    await assert.rejects(readFile(marker, 'utf8'), /ENOENT/);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('budget initialization refuses reset and concurrent recorders do not lose increments', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [budget, 'init', '--profile', 'standard'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const records = await Promise.all([
      execFileAsync(process.execPath, [
        budget, 'record', '--metric', 'exact_duplicate_commands'
      ], { cwd: repo, encoding: 'utf8' }),
      execFileAsync(process.execPath, [
        budget, 'record', '--metric', 'exact_duplicate_commands'
      ], { cwd: repo, encoding: 'utf8' })
    ]);
    assert.equal(records.length, 2);
    let state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.usage.exact_duplicate_commands, 2);

    result = run(process.execPath, [budget, 'init', '--profile', 'high-risk'], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /already exists|refus|force/i);
    state = JSON.parse(await readFile(runtimePath(repo, 'budget.json'), 'utf8'));
    assert.equal(state.profile, 'standard');
    assert.equal(state.usage.exact_duplicate_commands, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('checkpoint resumption revalidates receipt state against the evidence ledger', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const checkpoint = path.join(root, 'scripts/phase-checkpoint.mjs');
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'test', '--scope', 'focused',
      '--command', 'node --test', '--exit-code', '0',
      '--tests-passed', '1', '--tests-failed', '0'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const inputFile = runtimePath(repo, 'checkpoint-input.json');
    await writeFile(inputFile, `${JSON.stringify(checkpointInput({
      evidence_receipts: [{ id: receipt.id, status: 'valid' }]
    }))}\n`);
    result = run(process.execPath, [checkpoint, 'create', '--input', inputFile], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'invalidate', '--id', receipt.id,
      '--reason', 'reviewer invalidated installed-package proof'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [checkpoint, 'resume'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).evidence_receipts, [{
      id: receipt.id,
      status: 'stale',
      invalidation_reason: 'reviewer invalidated installed-package proof'
    }]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence identity includes repository-relative cwd and the exact argument vector', async () => {
  const repo = await tempRepo();
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    await mkdir(path.join(repo, 'a'));
    await mkdir(path.join(repo, 'b'));
    let result = run(process.execPath, [
      evidence, 'record', '--kind', 'command', '--scope', 'focused',
      '--command', 'node tool.mjs a b',
      '--command-argv', JSON.stringify(['node', 'tool.mjs', 'a b']),
      '--exit-code', '0'
    ], path.join(repo, 'a'));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.cwd, 'a');
    assert.deepEqual(receipt.command_argv, ['node', 'tool.mjs', 'a b']);
    assert.match(receipt.command_identity, /^[0-9a-f]{64}$/);

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'command', '--scope', 'focused',
      '--command', 'node tool.mjs a b',
      '--command-argv', JSON.stringify(['node', 'tool.mjs', 'a b'])
    ], path.join(repo, 'b'));
    assert.equal(result.status, 1, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'command', '--scope', 'focused',
      '--command', 'node tool.mjs a b',
      '--command-argv', JSON.stringify(['node', 'tool.mjs', 'a', 'b'])
    ], path.join(repo, 'a'));
    assert.equal(result.status, 1, result.stderr || result.stdout);

    result = run(process.execPath, [
      evidence, 'find', '--kind', 'command', '--scope', 'focused',
      '--command', 'node tool.mjs a b'
    ], path.join(repo, 'a'));
    assert.equal(result.status, 1, result.stderr || result.stdout);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence identity rejects a cwd genuinely outside the repository', async () => {
  const repo = await tempRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'zimster-evidence-outside-'));
  try {
    const evidence = path.join(root, 'scripts/evidence.mjs');
    const result = spawnSync(process.execPath, [
      evidence, 'record', '--kind', 'command', '--scope', 'focused',
      '--command', 'node outside.mjs',
      '--command-argv', JSON.stringify(['node', 'outside.mjs']),
      '--exit-code', '0'
    ], {
      cwd: outside,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_DIR: path.join(repo, '.git'),
        GIT_WORK_TREE: repo
      }
    });
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /outside.*repository/i);
    assert.doesNotMatch(result.stdout, /"cwd":"\.\./);
  } finally {
    await rm(outside, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});
