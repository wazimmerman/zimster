import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(args, cwd) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/review-control.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
}

function postmortem(args, cwd) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/run-postmortem.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('normal review control path binds one recheck to its canonical seam', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-control-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', [
      '-c', 'user.name=Zimster Test', '-c', 'user.email=test@example.com',
      'commit', '-m', 'candidate'
    ], { cwd: repo }).status, 0);
    const runtime = spawnSync('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'run.json'), `${JSON.stringify({
      schema_version: 2,
      id: 'run-review-control',
      started_at: '2026-08-17T00:00:00.000Z'
    })}\n`);
    await writeFile(path.join(runtime, 'budget.json'), `${JSON.stringify({
      schema_version: 1,
      limits: {
        correction_commits: 2,
        correction_rechecks: 1,
        final_integration_reviews: 2,
        complete_suite_executions: 3
      },
      usage: {
        correction_commits: 0,
        correction_rechecks: 0,
        final_integration_reviews: 0,
        complete_suite_executions: 0
      },
      scoped_usage: { correction_rechecks: {} },
      overrides: [],
      proof_obligations: []
    })}\n`);

    let result = run([
      'init', '--seam-id', 'release-seam', '--candidate-digest', 'candidate-a'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = run([
      'event', '--type', 'INITIAL_REVIEW', '--reviewer-id', 'reviewer-1',
      '--verdict', 'needs_correction'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(['event', '--type', 'OWNER_CORRECTION'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run([
      'event', '--type', 'CORRECTION_RECHECK', '--reviewer-id', 'reviewer-1',
      '--verdict', 'approved'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'FINAL_INTEGRATION_REVIEW_REQUIRED');

    const accounting = postmortem(['--runtime', runtime], repo);
    assert.equal(accounting.status, 0, accounting.stderr || accounting.stdout);
    const report = JSON.parse(await readFile(JSON.parse(accounting.stdout).report, 'utf8'));
    assert.equal(report.metrics.reviews.value, 2);
    assert.equal(report.metrics.corrections.value, 1);
    assert.equal(report.metrics.rechecks.value, 1);
    assert.equal(report.metrics.final_integration_reviews.value, 0);
    assert.equal(report.metrics.review_lifecycle.authority, 'reviews/lifecycle.json');
    assert.equal(report.metrics.review_lifecycle.aggregate.correction_rechecks, 1);

    result = run([
      'event', '--type', 'CORRECTION_RECHECK', '--reviewer-id', 'renamed-reviewer',
      '--verdict', 'approved', '--scope', 'fresh-scope', '--attempt-name', 'fresh-attempt',
      '--candidate-digest', 'fresh-digest'
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const stopped = JSON.parse(result.stdout);
    assert.equal(stopped.status, 'CIRCUIT_BREAKER');
    assert.equal(stopped.seam_id, 'release-seam');
    assert.equal(stopped.aggregate.correction_rechecks, 1);

    const canonical = JSON.parse(await readFile(
      path.join(runtime, 'reviews', 'lifecycle.json'), 'utf8'
    ));
    assert.equal(canonical.seam_id, 'release-seam');
    assert.equal(canonical.aggregate.correction_rechecks, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
