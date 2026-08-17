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

function run(repo, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/review-lifecycle.mjs'), ...args], {
    cwd: repo, encoding: 'utf8'
  });
}

test('review lifecycle CLI durably records the consumed recheck and breaker', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-lifecycle-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'base'], { cwd: repo }).status, 0);
    const base = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const runtime = spawnSync('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    async function reviewPackage(id, attemptType, attemptId, head, candidateTree) {
      const directory = path.join(runtime, 'reviews', id);
      const file = path.join(directory, 'review-package.json');
      await mkdir(directory, { recursive: true });
      await writeFile(file, JSON.stringify({
        schema_version: 2,
        id,
        attempt_type: attemptType,
        attempt_id: attemptId,
        seam_id: 'release-policy',
        base,
        head,
        candidate_checkout: {
          head,
          tree: candidateTree,
          dirty_tree_fingerprint: CLEAN
        },
        semantic_contract: { sha256: CONTRACT }
      }));
      return file;
    }

    let result = run(repo, 'init', '--seam-id', 'release-policy',
      '--reviewer-identity', 'reviewer-1', '--base', base, '--head', base,
      '--tree', tree, '--dirty-tree-fingerprint', CLEAN,
      '--semantic-contract-sha256', CONTRACT);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const nonexistentHead = 'f'.repeat(40);
    result = run(repo, 'candidate', '--seam-id', 'release-policy',
      '--base', base, '--head', nonexistentHead, '--tree', tree,
      '--dirty-tree-fingerprint', CLEAN, '--semantic-contract-sha256', CONTRACT);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /head.*commit|commit.*head|git object/i);

    const initialPackage = await reviewPackage(
      '1'.repeat(24), 'initial_review', 'attempt-initial', base, tree
    );
    result = run(repo, 'start', '--seam-id', 'release-policy',
      '--attempt-type', 'initial_review', '--attempt-id', 'attempt-initial',
      '--reviewer-identity', 'reviewer-1', '--review-package', initialPackage);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(repo, 'verdict', '--seam-id', 'release-policy',
      '--attempt-id', 'attempt-initial', '--verdict', 'needs_correction',
      '--findings', JSON.stringify([{ severity: 'Important', summary: 'breaker bypass' }]));
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(path.join(repo, 'tracked.txt'), 'corrected\n');
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'correction'], { cwd: repo }).status, 0);
    const corrected = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const correctedTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    result = run(repo, 'correction', '--seam-id', 'release-policy',
      '--base', base, '--head', corrected, '--tree', correctedTree,
      '--dirty-tree-fingerprint', CLEAN, '--semantic-contract-sha256', CONTRACT);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const recheckPackage = await reviewPackage(
      '2'.repeat(24), 'correction_recheck', 'attempt-recheck', corrected, correctedTree
    );
    result = run(repo, 'start', '--seam-id', 'release-policy',
      '--attempt-type', 'correction_recheck', '--attempt-id', 'attempt-recheck',
      '--reviewer-identity', 'reviewer-1', '--review-package', recheckPackage);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(repo, 'verdict', '--seam-id', 'release-policy',
      '--attempt-id', 'attempt-recheck', '--verdict', 'needs_correction',
      '--findings', JSON.stringify([{ severity: 'Critical', summary: 'still bypassable' }]));
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const finalPackage = await reviewPackage(
      '3'.repeat(24), 'final_integration_review', 'attempt-final', corrected, correctedTree
    );
    const forbidden = run(repo, 'start', '--seam-id', 'release-policy',
      '--attempt-type', 'final_integration_review', '--attempt-id', 'attempt-final',
      '--reviewer-identity', 'reviewer-1', '--review-package', finalPackage);
    assert.notEqual(forbidden.status, 0);
    assert.match(forbidden.stderr, /circuit breaker/i);

    result = run(repo, 'show', '--seam-id', 'release-policy');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = JSON.parse(result.stdout);
    assert.equal(state.status, 'circuit_breaker_active');
    assert.equal(state.correction_recheck_consumed, true);
    assert.deepEqual(state.attempts.map(({ attempt_id }) => attempt_id), [
      'attempt-initial', 'attempt-recheck'
    ]);

    const ledger = (await readFile(path.join(runtime, 'review-lifecycle', 'attempts.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(ledger.map(({ attempt_id }) => attempt_id), [
      'attempt-initial', 'attempt-recheck'
    ]);

    const stateFile = path.join(runtime, 'review-lifecycle', 'release-policy.json');
    const legacy = JSON.parse(await readFile(stateFile, 'utf8'));
    delete legacy.review_policy;
    delete legacy.strategy_escalation;
    delete legacy.historical_excess_attempt_ids;
    await writeFile(stateFile, `${JSON.stringify(legacy, null, 2)}\n`);
    result = run(repo, 'show', '--seam-id', 'release-policy');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cardinality policy|review policy|reconcil/i);

    result = run(repo, 'reconcile', '--seam-id', 'release-policy');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reconciled = JSON.parse(result.stdout);
    assert.equal(reconciled.review_policy.final_integration_reviews, 2);
    assert.deepEqual(reconciled.historical_excess_attempt_ids, []);
    assert.equal(reconciled.events.at(-1).type, 'policy_reconciled');
    assert.deepEqual(reconciled.attempts.map(({ attempt_id }) => attempt_id), [
      'attempt-initial', 'attempt-recheck'
    ]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('review lifecycle CLI refuses nonexistent evidence for exhausted-review approval', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-evidence-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'base'], { cwd: repo }).status, 0);
    const base = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const baseTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const candidate = {
      base_sha: base,
      head_sha: base,
      tree_sha: baseTree,
      dirty_tree_fingerprint: CLEAN,
      semantic_contract_sha256: CONTRACT
    };
    let state = createReviewLifecycle({
      seam_id: 'release-policy', reviewer_identity: 'reviewer-1', candidate
    });
    const start = (current, attempt_type, attempt_id, nextCandidate = current.candidate) =>
      applyReviewLifecycleEvent(current, {
        type: 'attempt_started',
        attempt: {
          attempt_type,
          attempt_id,
          seam_id: 'release-policy',
          reviewer_identity: 'reviewer-1',
          review_package_id: `package-${attempt_id}`,
          candidate: nextCandidate
        }
      });
    const verdict = (current, attempt_id, value, findings = []) =>
      applyReviewLifecycleEvent(current, {
        type: 'verdict_recorded', attempt_id, verdict: value, findings
      });
    state = start(state, 'initial_review', 'attempt-initial');
    state = verdict(state, 'attempt-initial', 'approved');
    state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
    state = start(state, 'final_integration_review', 'attempt-final-1');
    state = verdict(state, 'attempt-final-1', 'needs_correction', [{
      severity: 'Important', summary: 'First final defect.'
    }]);

    await writeFile(path.join(repo, 'tracked.txt'), 'corrected\n');
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'correction'], { cwd: repo }).status, 0);
    const corrected = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const correctedTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const correctedCandidate = {
      ...candidate, head_sha: corrected, tree_sha: correctedTree
    };
    state = applyReviewLifecycleEvent(state, {
      type: 'correction_recorded', candidate: correctedCandidate
    });
    state = applyReviewLifecycleEvent(state, { type: 'candidate_stabilized' });
    state = start(state, 'final_integration_review', 'attempt-final-2', correctedCandidate);
    state = verdict(state, 'attempt-final-2', 'needs_correction', [{
      severity: 'Critical', summary: 'Final authorization remains bypassable.'
    }]);
    assert.equal(state.status, 'strategy_escalation_required');

    const runtime = spawnSync('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const lifecycleDirectory = path.join(runtime, 'review-lifecycle');
    await mkdir(lifecycleDirectory, { recursive: true });
    await writeFile(
      path.join(lifecycleDirectory, 'release-policy.json'),
      `${JSON.stringify(state, null, 2)}\n`
    );

    const result = run(repo, 'disposition', '--seam-id', 'release-policy',
      '--disposition', 'reviewer_rebutted_with_evidence',
      '--reason', 'A forged reference must not authorize the candidate.',
      '--evidence-refs', JSON.stringify(['does-not-exist']));
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /evidence.*not.*authenticated|receipt.*not.*found/i);
    const persisted = JSON.parse(await readFile(
      path.join(lifecycleDirectory, 'release-policy.json'), 'utf8'
    ));
    assert.equal(persisted.status, 'strategy_escalation_required');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
