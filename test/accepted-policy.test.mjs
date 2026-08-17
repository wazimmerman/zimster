import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

test('a self-host run can bind accepted policy to a durable immutable Git object', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-accepted-policy-bind-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'zimster-accepted-policy-source-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.invalid'], repo).status, 0);
    const contents = `${JSON.stringify({
      schema_version: 1,
      autonomous_convergence: {
        enabled: true,
        limits: {
          correction_commits: 2,
          correction_rechecks: 2,
          final_integration_reviews: 2,
          final_verification_attempts: 2,
          complete_suite_executions: 3,
          exact_duplicate_commands: 2,
          context_renewals: 2
        }
      }
    }, null, 2)}\n`;
    const digest = createHash('sha256').update(contents).digest('hex');
    await writeFile(path.join(repo, 'frozen-convergence.json'), contents);
    assert.equal(run('git', ['add', 'frozen-convergence.json'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'frozen policy'], repo).status, 0);
    const commit = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    const externalPolicy = path.join(external, 'convergence.json');
    await writeFile(externalPolicy, contents);
    let result = run(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'high-risk',
      '--self-hosting-candidate', '0.7.1',
      '--accepted-policy-config', externalPolicy,
      '--accepted-policy-sha256', digest
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), 'bind-accepted-policy',
      '--commit', commit, '--path', 'frozen-convergence.json', '--sha256', digest
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], repo).stdout.trim();
    const bootstrap = JSON.parse(await readFile(path.join(runtime, 'bootstrap.json'), 'utf8'));
    assert.deepEqual(bootstrap.accepted_policy.immutable_source, {
      kind: 'git_object', commit, path: 'frozen-convergence.json'
    });
    assert.equal(
      createHash('sha256').update(await readFile(bootstrap.accepted_policy.path)).digest('hex'),
      digest
    );
    assert.equal(bootstrap.accepted_policy.path.startsWith(path.join(runtime, 'accepted-policy')), true);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
