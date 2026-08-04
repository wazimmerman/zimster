import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-verify-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

function verificationRuntime(repo) {
  return run(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/verification'],
    repo
  ).stdout.trim();
}

test('verification runner preserves step order and full logs while emitting one compact receipt', async () => {
  const repo = await tempRepo();
  try {
    const order = path.join(repo, 'order.txt');
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'fixture',
      steps: [
        {
          id: 'first',
          command: process.execPath,
          args: ['-e', "import { appendFileSync, writeSync } from 'node:fs'; appendFileSync(process.argv[1], 'first\\n'); writeSync(process.stdout.fd, 'PASS first detail\\n'.repeat(1000));", order]
        },
        {
          id: 'second',
          command: process.execPath,
          args: ['-e', "import { appendFileSync, writeSync } from 'node:fs'; appendFileSync(process.argv[1], 'second\\n'); writeSync(process.stdout.fd, 'PASS second detail\\n'.repeat(1000));", order]
        }
      ]
    })}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.length < 2000, `summary was ${result.stdout.length} bytes`);
    assert.doesNotMatch(result.stdout, /PASS first detail|PASS second detail/);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.deepEqual(summary.steps.map(({ id }) => id), ['first', 'second']);
    assert.equal(summary.warnings, 0);
    assert.equal(await readFile(order, 'utf8'), 'first\nsecond\n');

    const fullLog = await readFile(path.join(summary.log_directory, 'first.log'), 'utf8');
    assert.match(fullLog, /PASS first detail/);
    assert.ok(fullLog.length > 10_000);
    const receipts = await readdir(path.join(verificationRuntime(repo), 'receipts'));
    assert.deepEqual(receipts, [`${summary.id}.json`]);
    assert.equal(JSON.parse(await readFile(summary.receipt, 'utf8')).status, 'passed');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('verification runner stops after failure and returns a concise actionable summary', async () => {
  const repo = await tempRepo();
  try {
    const order = path.join(repo, 'order.txt');
    const marker = path.join(repo, 'must-not-run.txt');
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'fixture',
      steps: [
        {
          id: 'first',
          command: process.execPath,
          args: ['-e', "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[1], 'first\\n');", order]
        },
        {
          id: 'fails',
          command: process.execPath,
          args: ['-e', "import { appendFileSync, writeSync } from 'node:fs'; appendFileSync(process.argv[1], 'fails\\n'); writeSync(process.stderr.fd, 'repair the generated mirror\\n'); process.exit(3);", order]
        },
        {
          id: 'later',
          command: process.execPath,
          args: ['-e', "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], 'ran\\n');", marker]
        }
      ]
    })}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.failed_step, 'fails');
    assert.match(summary.action, /repair the generated mirror/);
    assert.deepEqual(summary.steps.map(({ status }) => status), ['passed', 'failed', 'not_run']);
    assert.equal(await readFile(order, 'utf8'), 'first\nfails\n');
    await assert.rejects(readFile(marker, 'utf8'), /ENOENT/);
    assert.match(await readFile(path.join(summary.log_directory, 'fails.log'), 'utf8'), /repair the generated mirror/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('verification runner rejects warnings from otherwise successful steps', async () => {
  const repo = await tempRepo();
  try {
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'fixture',
      steps: [{
        id: 'warns',
        command: process.execPath,
        args: ['-e', "import { writeSync } from 'node:fs'; writeSync(process.stderr.fd, 'warning: unexpected fallback\\n');"]
      }]
    })}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.warnings, 1);
    assert.equal(summary.steps[0].reason, 'unexpected_stderr');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('verification profiles place installed-package smoke before immutable review packaging', () => {
  const runner = path.join(root, 'scripts/verify.mjs');
  const goal = run(process.execPath, [runner, 'describe', '--profile', 'goal'], root);
  assert.equal(goal.status, 0, goal.stderr || goal.stdout);
  const release = run(process.execPath, [runner, 'describe', '--profile', 'release'], root);
  assert.equal(release.status, 0, release.stderr || release.stdout);
  const goalSteps = JSON.parse(goal.stdout).steps.map(({ id }) => id);
  const releaseSteps = JSON.parse(release.stdout).steps.map(({ id }) => id);
  assert.ok(goalSteps.indexOf('package') < goalSteps.indexOf('installed-package-smoke'));
  assert.ok(goalSteps.indexOf('installed-package-smoke') < goalSteps.indexOf('review-package'));
  assert.ok(releaseSteps.includes('checksums'));
  assert.ok(releaseSteps.indexOf('review-package') < releaseSteps.indexOf('semantic-completion'));
  assert.ok(releaseSteps.indexOf('semantic-completion') < releaseSteps.indexOf('postmortem'));
  assert.equal(goalSteps.includes('checksums'), false);
});

test('release verification keeps the prose objective separate from binding requirement JSON', async () => {
  const runner = await readFile(path.join(root, 'scripts/verify.mjs'), 'utf8');
  assert.match(runner, /'--requirements', String\(options\['binding-requirements'\]\)/);
  assert.match(runner, /'requirements', 'binding-requirements'/);
});

test('package exposes canonical goal and release verification entry points', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['goal:verify'], 'node scripts/verify.mjs run --profile goal');
  assert.equal(packageJson.scripts['release:verify'], 'node scripts/verify.mjs run --profile release');
});

test('verification runner accounts for a declared complete suite before execution', async () => {
  const repo = await tempRepo();
  try {
    const budget = run(process.execPath, [
      path.join(root, 'scripts/run-budget.mjs'), 'init', '--profile', 'standard'
    ], repo);
    assert.equal(budget.status, 0, budget.stderr || budget.stdout);
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'fixture-complete',
      complete_suite: true,
      steps: [{
        id: 'passes',
        command: process.execPath,
        args: ['-e', 'process.exit(0);']
      }]
    })}\n`);
    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const budgetFile = path.join(path.dirname(verificationRuntime(repo)), 'budget.json');
    const state = JSON.parse(await readFile(budgetFile, 'utf8'));
    assert.equal(state.usage.complete_suite_executions, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('verification runner carries a proof-backed strategy when a required suite crosses budget', async () => {
  const repo = await tempRepo();
  try {
    const budget = path.join(root, 'scripts/run-budget.mjs');
    let result = run(process.execPath, [
      budget, 'init', '--profile', 'standard'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [
      budget, 'record', '--metric', 'complete_suite_executions', '--amount', '3'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'budgeted-release',
      complete_suite: true,
      steps: [{
        id: 'passes',
        command: process.execPath,
        args: ['-e', 'process.exit(0);']
      }]
    })}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile,
      '--strategy-change', 'required refreshed final tree',
      '--required-proof', 'refreshed release receipt',
      '--required-proof-type', 'verification',
      '--required-proof-profile', 'budgeted-release'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.budget.status, 'BUDGET_OVERRIDE');
    const state = JSON.parse(await readFile(
      path.join(path.dirname(verificationRuntime(repo)), 'budget.json'),
      'utf8'
    ));
    assert.equal(state.usage.complete_suite_executions, 4);
    assert.equal(state.proof_obligations.at(-1).proof, 'refreshed release receipt');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
