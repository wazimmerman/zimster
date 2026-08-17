import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import { authenticateGovernedEvidenceReceipt } from '../scripts/lib/governed-terminal-auth.mjs';

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

test('passed governed verification can be bridged into claim-scoped evidence without re-execution', async () => {
  const repo = await tempRepo();
  try {
    const planFile = path.join(repo, 'plan.json');
    const externalProgram = path.join(repo, '.git', 'bridge-helper.mjs');
    await writeFile(externalProgram, "process.stdout.write('verified output\\n');\n");
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'bridge-source',
      complete_suite: false,
      steps: [{
        id: 'proof-step',
        command: process.execPath,
        args: [externalProgram],
        input_files: [externalProgram],
        requirement_ids: ['CTRL-EVIDENCE-001', 'CTRL-PAIRING-001'],
        establishes: [
          'The authenticated verification step passed.',
          'The second declared claim passed.'
        ],
        does_not_establish: ['Any unselected verification step.'],
        environment_scopes: ['node-git-local']
      }, {
        id: 'other-step',
        command: process.execPath,
        args: ['-e', "process.stdout.write('other output\\n');"],
        requirement_ids: ['CTRL-OTHER-001'],
        establishes: ['The other verification step passed.'],
        does_not_establish: ['The proof step result.'],
        environment_scopes: ['other-environment']
      }]
    })}\n`);
    let result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const verification = JSON.parse(result.stdout);

    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step"]',
      '--kind', 'verification', '--scope', 'claim-scope',
      '--requirement-ids', '["CTRL-EVIDENCE-001"]',
      '--establishes', '["The authenticated verification step passed."]',
      '--does-not-establish', '["Any unselected verification step."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const bridgeTerminalBytes = result.stdout;
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.source, 'verification-bridge');
    assert.equal(evidence.upstream_verification_receipt_id, verification.id);
    assert.deepEqual(evidence.upstream_verification_step_ids, ['proof-step']);
    assert.equal(evidence.upstream_verification_authenticated, true);
    assert.deepEqual(evidence.claim_bindings.map(({ requirement_id, claim }) => ({
      requirement_id,
      claim
    })), [{
      requirement_id: 'CTRL-EVIDENCE-001',
      claim: 'The authenticated verification step passed.'
    }]);
    assert.ok(evidence.claim_bindings[0].input_fingerprints.some(
      ({ input }) => input.endsWith('bridge-helper.mjs')
    ));
    assert.deepEqual(evidence.requirement_ids, ['CTRL-EVIDENCE-001']);
    assert.deepEqual(evidence.establishes, ['The authenticated verification step passed.']);
    const fullVerification = JSON.parse(await readFile(verification.receipt, 'utf8'));
    assert.deepEqual(
      evidence.upstream_verification_step_contracts[0].input_fingerprints,
      fullVerification.steps.find(({ id }) => id === 'proof-step').input_fingerprints
    );
    assert.ok(evidence.inputs.some((input) => input.endsWith('bridge-helper.mjs')));
    assert.equal(evidence.exit_code, 0);
    assert.equal(await authenticateGovernedEvidenceReceipt(
      path.dirname(verificationRuntime(repo)),
      evidence,
      bridgeTerminalBytes
    ), true);
    assert.equal(await readFile(path.join(repo, 'tracked.txt'), 'utf8'), 'base\n');

    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step"]',
      '--kind', 'verification', '--scope', 'ambiguous-pairing',
      '--requirement-ids', '["CTRL-EVIDENCE-001","CTRL-PAIRING-001"]',
      '--establishes', '["The authenticated verification step passed.","The second declared claim passed."]',
      '--does-not-establish', '["Any unselected verification step."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /one exact requirement.*claim pair|ambiguous/i);

    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step","other-step"]',
      '--kind', 'verification', '--scope', 'cross-step-synthesis',
      '--requirement-ids', '["CTRL-EVIDENCE-001"]',
      '--establishes', '["The other verification step passed."]',
      '--does-not-establish', '["Any unselected verification step.","The proof step result."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /single selected step contract|cross-step/i);

    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step"]',
      '--kind', 'verification', '--scope', 'omitted-caveat',
      '--requirement-ids', '["CTRL-EVIDENCE-001"]',
      '--establishes', '["The authenticated verification step passed."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /required caveat|does_not_establish/i);

    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step"]',
      '--kind', 'verification', '--scope', 'overclaim',
      '--requirement-ids', '["CTRL-EVIDENCE-001"]',
      '--establishes', '["A broader claim not registered before execution."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /not declared by selected verification steps/i);

    await writeFile(externalProgram, "process.stdout.write('changed after verification\\n');\n");
    result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'bridge-verification',
      '--verification-receipt', verification.id,
      '--steps', '["proof-step"]',
      '--kind', 'verification', '--scope', 'changed-program',
      '--requirement-ids', '["CTRL-EVIDENCE-001"]',
      '--establishes', '["The authenticated verification step passed."]',
      '--does-not-establish', '["Any unselected verification step."]',
      '--environment-scope', 'node-git-local'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /executed input.*changed|input fingerprint/i);
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

test('missing declared input fails the step and terminalizes its governed execution', async () => {
  const repo = await tempRepo();
  try {
    const planFile = path.join(repo, 'plan.json');
    await writeFile(planFile, `${JSON.stringify({
      schema_version: 1,
      profile: 'missing-input-fixture',
      complete_suite: true,
      steps: [{
        id: 'generated-input',
        command: process.execPath,
        args: ['-e', 'process.exit(0);'],
        input_files: ['generated-but-missing.txt']
      }]
    })}\n`);

    const result = run(process.execPath, [
      path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.failed_step, 'generated-input');
    assert.equal(summary.steps[0].reason, 'missing_input');
    assert.match(summary.action, /generated-but-missing\.txt/);

    const verification = JSON.parse(await readFile(summary.receipt, 'utf8'));
    assert.equal(verification.status, 'failed');
    const executionDirectory = path.join(
      path.dirname(verificationRuntime(repo)), 'executions', 'receipts'
    );
    const executionFiles = await readdir(executionDirectory);
    assert.equal(executionFiles.length, 1);
    const execution = JSON.parse(await readFile(
      path.join(executionDirectory, executionFiles[0]), 'utf8'
    ));
    assert.equal(execution.status, 'failed');
    assert.equal(execution.exit_code, 1);
    assert.equal(execution.terminal_receipt_type, 'verification');
    assert.equal(execution.terminal_receipt_id, summary.id);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('thrown input fingerprint failures before and after execution terminalize governed executions', async (t) => {
  for (const phase of ['before', 'after']) {
    await t.test(phase, async () => {
      const repo = await tempRepo();
      try {
        const input = path.join(repo, 'fingerprint-loop.txt');
        if (phase === 'before') {
          await symlink('fingerprint-loop.txt', input);
        } else {
          await writeFile(input, 'initial\n');
        }
        const command = phase === 'before'
          ? 'process.exit(0);'
          : "import { rmSync, symlinkSync } from 'node:fs'; rmSync(process.argv[1]); symlinkSync('fingerprint-loop.txt', process.argv[1]);";
        const planFile = path.join(repo, 'plan.json');
        await writeFile(planFile, `${JSON.stringify({
          schema_version: 1,
          profile: `fingerprint-${phase}-fixture`,
          complete_suite: true,
          steps: [{
            id: 'fingerprint-input',
            command: process.execPath,
            args: ['-e', command, input],
            input_files: ['fingerprint-loop.txt']
          }]
        })}\n`);

        const result = run(process.execPath, [
          path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
        ], repo);
        assert.notEqual(result.status, 0, result.stderr || result.stdout);
        assert.equal(result.stderr, '');
        const summary = JSON.parse(result.stdout);
        assert.equal(summary.status, 'failed');
        assert.equal(summary.failed_step, 'fingerprint-input');
        assert.equal(summary.steps[0].reason, 'input_fingerprint_error');
        assert.match(summary.action, /fingerprint-loop\.txt|ELOOP/i);

        const verification = JSON.parse(await readFile(summary.receipt, 'utf8'));
        const executionDirectory = path.join(
          path.dirname(verificationRuntime(repo)), 'executions', 'receipts'
        );
        const executionFiles = await readdir(executionDirectory);
        assert.equal(executionFiles.length, 1);
        const execution = JSON.parse(await readFile(
          path.join(executionDirectory, executionFiles[0]), 'utf8'
        ));
        assert.equal(execution.status, 'failed');
        assert.equal(execution.terminal_receipt_type, 'verification');
        assert.equal(execution.terminal_receipt_id, summary.id);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
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
  assert.match(runner, /'review-lifecycle', 'assurance-accounting', 'execution-budget'/);
  assert.match(runner, /'--execution-budget', String\(options\['execution-budget'\]\)/);
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
    for (let index = 0; index < 3; index += 1) {
      result = run(process.execPath, [
        path.join(root, 'scripts/verify.mjs'), 'run', '--plan', planFile
      ], repo);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
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
