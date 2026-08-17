import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from '../scripts/lib/review-lifecycle.mjs';

const CLEAN = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const CONTRACT = 'e'.repeat(64);

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function runtimePath(repo, ...parts) {
  return path.join(run('git', [
    'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
  ], repo).stdout.trim(), ...parts);
}

async function fixture({ finalApproved = true, withReview = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-coherence-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'candidate'], repo).status, 0);
  let result = run(process.execPath, [
    path.join(root, 'scripts/init-run.mjs'),
    '--profile', 'high-risk', '--reason', 'coherence fixture'
  ], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = run(process.execPath, [
    path.join(root, 'scripts/run-control.mjs'), 'start',
    '--slice-id', 'final-candidate', '--slice-title', 'Final candidate',
    '--remaining-obligations', '[]',
    '--next-action', 'Run coherence preflight',
    '--next-command', 'node scripts/coherence-preflight.mjs check --operation completion'
  ], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
  const tree = run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim();
  const candidate = {
    base_sha: head,
    head_sha: head,
    tree_sha: tree,
    dirty_tree_fingerprint: CLEAN,
    semantic_contract_sha256: CONTRACT
  };
  let lifecycle = createReviewLifecycle({
    seam_id: 'whole-release', reviewer_identity: 'reviewer-1', candidate
  });
  lifecycle = applyReviewLifecycleEvent(lifecycle, {
    type: 'attempt_started',
    attempt: {
      attempt_type: 'initial_review', attempt_id: 'attempt-initial',
      seam_id: 'whole-release', reviewer_identity: 'reviewer-1',
      review_package_id: 'package-initial', candidate
    }
  });
  lifecycle = applyReviewLifecycleEvent(lifecycle, {
    type: 'verdict_recorded', attempt_id: 'attempt-initial', verdict: 'approved', findings: []
  });
  lifecycle = applyReviewLifecycleEvent(lifecycle, { type: 'candidate_stabilized' });
  if (finalApproved) {
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'attempt_started',
      attempt: {
        attempt_type: 'final_integration_review', attempt_id: 'attempt-final',
        seam_id: 'whole-release', reviewer_identity: 'reviewer-1',
        review_package_id: 'package-final', candidate
      }
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'verdict_recorded', attempt_id: 'attempt-final', verdict: 'approved', findings: []
    });
  }
  if (withReview) {
    await mkdir(runtimePath(repo, 'review-lifecycle'), { recursive: true });
    await writeFile(
      runtimePath(repo, 'review-lifecycle', 'whole-release.json'),
      `${JSON.stringify(lifecycle, null, 2)}\n`
    );
  }
  const attemptIds = lifecycle.attempts.map(({ attempt_id }) => attempt_id);
  if (withReview) {
    await mkdir(runtimePath(repo, 'assurance-accounting'), { recursive: true });
    await writeFile(runtimePath(repo, 'assurance-accounting', 'latest.json'), `${JSON.stringify({
    schema_version: 1,
    candidate_head: head,
    candidate_tree: tree,
    observed_agent_ids: ['reviewer-1'],
    dispatch_agent_ids: ['reviewer-1'],
    budget_agent_ids: ['reviewer-1'],
    observed_review_attempt_ids: attemptIds,
    recorded_review_attempt_ids: attemptIds,
    recorded_review_attempt_counts: {
      correction_rechecks: 0,
      final_integration_reviews: finalApproved ? 1 : 0
    },
    budget_review_attempt_counts: {
      correction_rechecks: 0,
      final_integration_reviews: finalApproved ? 1 : 0
    },
    observed_max_depth: 1,
    allowed_max_depth: 1,
    reconciliation_complete: true
    }, null, 2)}\n`);
  }
  const budgetFile = runtimePath(repo, 'budget.json');
  const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
  budget.usage.complete_suite_executions = 0;
  budget.usage.exact_duplicate_commands = 0;
  budget.usage.final_integration_reviews = finalApproved ? 1 : 0;
  await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
  result = run(process.execPath, [
    path.join(root, 'scripts/run-control.mjs'), 'refresh'
  ], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { repo, lifecycle, budgetFile };
}

function preflight(repo, operation, profile = 'high-risk') {
  return run(process.execPath, [
    path.join(root, 'scripts/coherence-preflight.mjs'), 'check',
    '--operation', operation, '--profile', profile, '--seam-id', 'whole-release'
  ], repo);
}

test('coherence preflight admits a stable review candidate and an exact final-approved completion', async () => {
  const review = await fixture({ finalApproved: false });
  const completion = await fixture({ finalApproved: true });
  try {
    let result = preflight(review.repo, 'review');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'COHERENCE_CURRENT');
    result = preflight(completion.repo, 'completion');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'COHERENCE_CURRENT');
  } finally {
    await rm(review.repo, { recursive: true, force: true });
    await rm(completion.repo, { recursive: true, force: true });
  }
});

test('final review admission runs coherence before creating its own transaction marker', async () => {
  const { repo, lifecycle } = await fixture({ finalApproved: false });
  try {
    const reviewPackageId = 'a'.repeat(24);
    const reviewDirectory = runtimePath(repo, 'reviews', reviewPackageId);
    const reviewPackage = path.join(reviewDirectory, 'review-package.json');
    await mkdir(reviewDirectory, { recursive: true });
    await writeFile(reviewPackage, `${JSON.stringify({
      schema_version: 2,
      id: reviewPackageId,
      attempt_type: 'final_integration_review',
      attempt_id: 'attempt-final-admission',
      seam_id: 'whole-release',
      base: lifecycle.candidate.base_sha,
      head: lifecycle.candidate.head_sha,
      candidate_checkout: {
        head: lifecycle.candidate.head_sha,
        tree: lifecycle.candidate.tree_sha,
        dirty_tree_fingerprint: CLEAN
      },
      semantic_contract: { sha256: CONTRACT }
    }, null, 2)}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/review-lifecycle.mjs'), 'start',
      '--seam-id', 'whole-release',
      '--attempt-type', 'final_integration_review',
      '--attempt-id', 'attempt-final-admission',
      '--reviewer-identity', 'reviewer-1',
      '--review-package', reviewPackage
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = JSON.parse(result.stdout);
    assert.equal(state.active_attempt_id, 'attempt-final-admission');
    await assert.rejects(
      readFile(runtimePath(repo, 'transactions', 'current.json')),
      /ENOENT/
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('Micro completion checks canonical coherence without inventing review state', async () => {
  const { repo } = await fixture({ finalApproved: false, withReview: false });
  try {
    let result = preflight(repo, 'completion', 'micro');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).profile, 'micro');
    result = preflight(repo, 'completion', 'standard');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).issues.join('\n'), /review lifecycle/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('coherence preflight reports every stale control-plane component without repairing it', async () => {
  const { repo, budgetFile } = await fixture({ finalApproved: true });
  try {
    await writeFile(runtimePath(repo, 'run.md'), '# stale derived summary\n');
    const checkpointFile = runtimePath(repo, 'checkpoints', 'current.json');
    const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
    checkpoint.remaining_obligations = ['Publish only after final authorization'];
    checkpoint.blocking_obligations = ['Renew exact-package host evidence'];
    checkpoint.repository_state.head = '0'.repeat(40);
    await writeFile(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.usage.complete_suite_executions = 2;
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
    await mkdir(runtimePath(repo, 'transactions'), { recursive: true });
    await writeFile(runtimePath(repo, 'transactions', 'current.json'), `${JSON.stringify({
      schema_version: 1,
      transaction_id: 'pending-control-mutation',
      mutation_type: 'evidence_recorded',
      actor_id: 'root',
      phase: 'started',
      run_state_revision_before: 1,
      candidate_before: {
        head: '0'.repeat(40), tree: '0'.repeat(40), dirty_tree_fingerprint: CLEAN
      },
      started_at: '2026-08-16T00:00:00.000Z'
    }, null, 2)}\n`);

    const result = preflight(repo, 'completion');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'COHERENCE_BLOCKED');
    assert.match(report.issues.join('\n'), /STALE_RUN_SUMMARY/i);
    assert.match(report.issues.join('\n'), /checkpoint.*head|head.*checkpoint/i);
    assert.match(report.issues.join('\n'), /remaining obligation/i);
    assert.match(report.issues.join('\n'), /STALE_ACCOUNTING/i);
    assert.match(report.issues.join('\n'), /pending control-plane mutation/i);
    assert.equal((await readFile(budgetFile, 'utf8')).includes('"complete_suite_executions": 2'), true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('coherence admits normal successful checkpoint states and defers operation-owned obligations', async () => {
  const { repo } = await fixture({ finalApproved: true });
  try {
    const checkpointFile = runtimePath(repo, 'checkpoints', 'current.json');
    for (const recoveryStatus of [
      'CONTROL_PLANE_MUTATION_CURRENT',
      'VERIFICATION_PASSED',
      'RECONCILED_CONTROL_PLANE_MUTATION',
      'RECONCILED_PARTIAL_MUTATION',
      'SLICE_COMPLETED'
    ]) {
      const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
      checkpoint.recovery_status = recoveryStatus;
      checkpoint.remaining_obligations = [
        'Consume final integration review',
        'Publish after signed authorization'
      ];
      checkpoint.blocking_obligations = [];
      await writeFile(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
      const refreshed = run(process.execPath, [
        path.join(root, 'scripts/run-control.mjs'), 'refresh'
      ], repo);
      assert.equal(refreshed.status, 0, refreshed.stderr || refreshed.stdout);
      const result = preflight(repo, 'completion');
      assert.equal(result.status, 0, `${recoveryStatus}: ${result.stderr || result.stdout}`);
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('coherence preflight aggregates malformed canonical components instead of aborting', async () => {
  const { repo, budgetFile } = await fixture({ finalApproved: true });
  try {
    await writeFile(runtimePath(repo, 'run.md'), '# stale derived summary\n');
    await writeFile(runtimePath(repo, 'review-lifecycle', 'whole-release.json'), '{bad');
    await writeFile(runtimePath(repo, 'assurance-accounting', 'latest.json'), '{also-bad');
    await writeFile(budgetFile, '{budget-bad');

    const result = preflight(repo, 'completion');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.match(report.issues.join('\n'), /review lifecycle.*malformed/i);
    assert.match(report.issues.join('\n'), /assurance accounting.*malformed/i);
    assert.match(report.issues.join('\n'), /execution budget.*malformed/i);
    assert.match(report.issues.join('\n'), /accounting.*unavailable/i);
    assert.match(report.issues.join('\n'), /STALE_RUN_SUMMARY/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('coherence rejects ambiguous duplicate proof identities instead of applying last-wins lookup', async () => {
  const { repo, budgetFile } = await fixture({ finalApproved: true });
  try {
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.proof_obligations = [{
      proof: 'duplicate-proof', status: 'required', metric: 'correction_commits',
      required_at: '2026-08-16T00:00:00.000Z', receipt_type: 'verification', profile: 'release'
    }, {
      proof: 'duplicate-proof', status: 'required', metric: 'complete_suite_executions',
      required_at: '2026-08-16T00:00:01.000Z', receipt_type: 'verification', profile: 'release'
    }];
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
    const result = preflight(repo, 'completion');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).issues.join('\n'), /duplicate proof identity.*duplicate-proof/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('live coherence rejects assurance that predates a lifecycle attempt', async () => {
  const { repo } = await fixture({ finalApproved: true });
  try {
    const lifecycleFile = runtimePath(repo, 'review-lifecycle', 'whole-release.json');
    const lifecycle = JSON.parse(await readFile(lifecycleFile, 'utf8'));
    lifecycle.attempts.push({
      attempt_type: 'final_integration_review',
      attempt_id: 'attempt-after-assurance',
      seam_id: 'whole-release',
      reviewer_identity: 'reviewer-1',
      review_package_id: 'package-after-assurance',
      candidate: lifecycle.candidate,
      verdict: null,
      findings: []
    });
    await writeFile(lifecycleFile, `${JSON.stringify(lifecycle, null, 2)}\n`);
    const result = preflight(repo, 'completion');
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(
      JSON.parse(result.stdout).issues.join('\n'),
      /assurance|attempt-after-assurance|recorded review attempt/i
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('final-review start performs coherence admission before recording an attempt', async () => {
  const { repo, lifecycle, budgetFile } = await fixture({ finalApproved: false });
  try {
    const reviewPackageId = '1'.repeat(24);
    const reviewDirectory = runtimePath(repo, 'reviews', reviewPackageId);
    await mkdir(reviewDirectory, { recursive: true });
    const reviewPackage = path.join(reviewDirectory, 'review-package.json');
    await writeFile(reviewPackage, `${JSON.stringify({
      schema_version: 2,
      id: reviewPackageId,
      attempt_type: 'final_integration_review',
      attempt_id: 'attempt-final',
      seam_id: 'whole-release',
      base: lifecycle.candidate.base_sha,
      head: lifecycle.candidate.head_sha,
      candidate_checkout: {
        head: lifecycle.candidate.head_sha,
        tree: lifecycle.candidate.tree_sha,
        dirty_tree_fingerprint: lifecycle.candidate.dirty_tree_fingerprint
      },
      semantic_contract: { sha256: lifecycle.candidate.semantic_contract_sha256 }
    }, null, 2)}\n`);
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    budget.usage.complete_suite_executions = 1;
    await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/review-lifecycle.mjs'), 'start',
      '--seam-id', 'whole-release',
      '--attempt-type', 'final_integration_review',
      '--attempt-id', 'attempt-final',
      '--reviewer-identity', 'reviewer-1',
      '--review-package', reviewPackage
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /COHERENCE_BLOCKED.*STALE_ACCOUNTING/i);
    const unchanged = JSON.parse(await readFile(
      runtimePath(repo, 'review-lifecycle', 'whole-release.json'),
      'utf8'
    ));
    assert.deepEqual(unchanged.attempts.map(({ attempt_id }) => attempt_id), ['attempt-initial']);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
