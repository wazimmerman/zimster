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

test('verification runner accepts only an explicitly matched informational stderr line', async () => {
  const repo = await tempRepo();
  try {
    const planFile = path.join(repo, 'plan.json');
    const plan = {
      schema_version: 1,
      profile: 'fixture',
      steps: [{
        id: 'semantic-completion',
        command: process.execPath,
        args: ['-e', "import { writeSync } from 'node:fs'; writeSync(process.stderr.fd, process.argv[1]);", 'CANDIDATE_COMPLETE review=review-001 claims=19\n'],
        expected_stderr: '^CANDIDATE_COMPLETE review=[A-Za-z0-9._/-]+ claims=[0-9]+\\n?$'
      }]
    };
    await writeFile(planFile, `${JSON.stringify(plan)}\n`);

    let result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.warnings, 0);

    plan.steps[0].args[2] = 'CANDIDATE_COMPLETE review=review-001 claims=19\nwarning: bypass\n';
    await writeFile(planFile, `${JSON.stringify(plan)}\n`);
    result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    summary = JSON.parse(result.stdout);
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
  assert.match(runner, /HUMAN_RELEASE_REVIEW_ACCEPTED/);
  assert.match(runner, /'release-review'/);
  assert.doesNotMatch(runner, /semanticStep\.expected_stderr\s*=\s*'\^CANDIDATE_COMPLETE/);
});

test('release verification emits the canonical signed review binding as a portable input', async () => {
  const repo = await tempRepo();
  try {
    const commit = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    const tree = run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim();
    const authorization = {
      state: 'HUMAN_RELEASE_REVIEW_ACCEPTED',
      review_id: 'final-review',
      reviewer_provenance: 'not_host_authenticated',
      candidate_base: 'a'.repeat(40),
      candidate_head: commit,
      candidate_tree: tree,
      review_package_id: 'package-final',
      requirement_matrix_sha256: 'b'.repeat(64),
      semantic_contract_sha256: 'c'.repeat(64),
      required_lenses: ['release-integrity']
    };
    const decision = JSON.stringify({
      accepted: true,
      state: 'HUMAN_RELEASE_REVIEW_ACCEPTED',
      authorization
    });
    const planFile = path.join(repo, 'release-plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'release',
      steps: [{
        id: 'semantic-completion',
        command: process.execPath,
        args: ['-e', "console.log(process.argv[1]); process.stderr.write('HUMAN_RELEASE_REVIEW_ACCEPTED review=final-review provenance=not_host_authenticated\\n');", decision],
        expected_stderr: '^HUMAN_RELEASE_REVIEW_ACCEPTED review=final-review provenance=not_host_authenticated\\n?$'
      }]
    })}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    if (result.status !== 0) {
      const failedSummary = JSON.parse(result.stdout);
      assert.equal(result.status, 0, await readFile(
        path.join(failedSummary.log_directory, 'semantic-completion.log'), 'utf8'
      ));
    }
    const summary = JSON.parse(result.stdout);
    const releaseInput = JSON.parse(await readFile(summary.release_input, 'utf8'));
    assert.equal(releaseInput.candidate_commit, commit);
    assert.equal(releaseInput.candidate_tree, tree);
    assert.deepEqual(releaseInput.release_review_authorization, authorization);
    assert.deepEqual(releaseInput.steps.map(({ log_id }) => log_id), ['verification/semantic-completion']);
    assert.doesNotMatch(JSON.stringify(releaseInput), new RegExp(repo.replaceAll('\\', '\\\\')));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
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

test('verification runner stops before a suite when its hard execution ceiling is exhausted', async () => {
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
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.budget.status, 'HARD_BUDGET_EXHAUSTED');
    assert.equal(summary.failed_step, 'execution-budget');
    assert.equal(summary.steps[0].status, 'not_run');
    const state = JSON.parse(await readFile(
      path.join(path.dirname(verificationRuntime(repo)), 'budget.json'),
      'utf8'
    ));
    assert.equal(state.usage.complete_suite_executions, 3);
    assert.deepEqual(state.proof_obligations, []);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
