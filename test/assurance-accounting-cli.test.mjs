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

test('assurance accounting reconciles host observations with durable ledgers', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-assurance-accounting-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'candidate'], { cwd: repo }).status, 0);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const runtime = spawnSync('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    await mkdir(path.join(runtime, 'dispatches'), { recursive: true });
    await mkdir(path.join(runtime, 'review-lifecycle'), { recursive: true });
    await writeFile(path.join(runtime, 'dispatches/dispatches.jsonl'), `${JSON.stringify({
      schema_version: 2, agent_id: 'agent-reviewer'
    })}\n`);
    await writeFile(path.join(runtime, 'budget.json'), JSON.stringify({
      schema_version: 1,
      optional_agent_identities: ['agent-reviewer'],
      usage: { correction_rechecks: 0, final_integration_reviews: 1 }
    }));
    const candidate = {
      base_sha: head,
      head_sha: head,
      tree_sha: tree,
      dirty_tree_fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      semantic_contract_sha256: 'a'.repeat(64)
    };
    let lifecycle = createReviewLifecycle({
      seam_id: 'release-policy', reviewer_identity: 'agent-reviewer', candidate
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'attempt_started',
      attempt: {
        attempt_type: 'initial_review', attempt_id: 'attempt-initial',
        seam_id: 'release-policy', reviewer_identity: 'agent-reviewer',
        review_package_id: 'package-initial', candidate
      }
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'verdict_recorded', attempt_id: 'attempt-initial', verdict: 'approved', findings: []
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'candidate_stabilized'
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'attempt_started',
      attempt: {
        attempt_type: 'final_integration_review', attempt_id: 'attempt-final',
        seam_id: 'release-policy', reviewer_identity: 'agent-reviewer',
        review_package_id: 'package-final', candidate
      }
    });
    lifecycle = applyReviewLifecycleEvent(lifecycle, {
      type: 'verdict_recorded', attempt_id: 'attempt-final', verdict: 'approved', findings: []
    });
    await writeFile(
      path.join(runtime, 'review-lifecycle/release-policy.json'),
      JSON.stringify(lifecycle)
    );
    const observed = path.join(repo, 'observed.json');
    await writeFile(observed, JSON.stringify({
      schema_version: 1,
      candidate_head: head,
      candidate_tree: tree,
      observed_agent_ids: ['agent-reviewer'],
      observed_review_attempt_ids: ['attempt-initial', 'attempt-final'],
      observed_max_depth: 1,
      allowed_max_depth: 1,
      observation_complete: true
    }));

    let result = spawnSync(process.execPath, [
      path.join(root, 'scripts/assurance-accounting.mjs'), 'reconcile',
      '--observed', observed
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.reconciliation_complete, true);
    assert.deepEqual(receipt.dispatch_agent_ids, ['agent-reviewer']);
    assert.deepEqual(receipt.budget_agent_ids, ['agent-reviewer']);
    assert.deepEqual(receipt.recorded_review_attempt_ids, ['attempt-final', 'attempt-initial']);
    assert.equal(JSON.parse(await readFile(
      path.join(runtime, 'assurance-accounting/latest.json'), 'utf8'
    )).candidate_head, head);

    await writeFile(path.join(runtime, 'budget.json'), JSON.stringify({
      schema_version: 1,
      optional_agent_identities: ['agent-reviewer'],
      usage: { correction_rechecks: 0, final_integration_reviews: 0 }
    }));
    result = spawnSync(process.execPath, [
      path.join(root, 'scripts/assurance-accounting.mjs'), 'reconcile',
      '--observed', observed
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).reconciliation_complete, false);
    assert.match(result.stderr, /budget|final integration review/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
