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
      id: 'run-review-control'
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
