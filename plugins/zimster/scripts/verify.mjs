import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { recordExecutionBudgetEvent } from './lib/execution-budget.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (name) => path.join(packageRoot, 'scripts', name);
const nodeStep = (id, name, args = []) => ({
  id,
  command: process.execPath,
  args: [script(name), ...args]
});
const commonBeforePackage = [
  { id: 'tests', command: process.execPath, args: ['--test', '--test-reporter=spec'] },
  nodeStep('validate', 'validate.mjs')
];
const commonAfterPackage = [
  nodeStep('doctor', 'doctor.mjs', ['--json']),
  nodeStep('codex-validation', 'validate-codex.mjs'),
  nodeStep('archive-safety', 'archive-safety.mjs'),
  nodeStep('secret-scan', 'secret-scan.mjs'),
  nodeStep('installed-package-smoke', 'installed-package-smoke.mjs'),
  nodeStep('host-smoke', 'host-smoke.mjs'),
  nodeStep('review-package', 'review-package.mjs', [
    '--attempt-type', 'initial_review',
    '--attempt-id', 'goal-verification',
    '--seam-id', 'whole-change'
  ])
];
const BUILTIN_PROFILES = Object.freeze({
  goal: {
    schema_version: 1,
    profile: 'goal',
    complete_suite: true,
    steps: [
      ...commonBeforePackage,
      nodeStep('package', 'package.mjs'),
      ...commonAfterPackage
    ]
  },
  release: {
    schema_version: 1,
    profile: 'release',
    complete_suite: true,
    steps: [
      ...commonBeforePackage,
      nodeStep('plan-conformance', 'plan-conformance.mjs'),
      nodeStep('version-check', 'check-version.mjs'),
      nodeStep('package', 'package.mjs'),
      nodeStep('checksums', 'checksums.mjs'),
      ...commonAfterPackage,
      nodeStep('semantic-completion', 'semantic-assurance.mjs'),
      nodeStep('postmortem', 'run-postmortem.mjs')
    ]
  }
});

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

function validatePlan(plan) {
  if (!plan || plan.schema_version !== 1 || typeof plan.profile !== 'string') {
    throw new Error('verification plan requires schema_version 1 and profile');
  }
  if (!Array.isArray(plan.steps) || !plan.steps.length) {
    throw new Error('verification plan requires at least one step');
  }
  const ids = new Set();
  for (const step of plan.steps) {
    if (
      !step
      || typeof step.id !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(step.id)
      || typeof step.command !== 'string'
      || !step.command
      || !Array.isArray(step.args)
      || !step.args.every((argument) => typeof argument === 'string')
    ) {
      throw new Error('verification steps require a safe id, command, and string args');
    }
    if (step.expected_stderr !== undefined) {
      if (
        typeof step.expected_stderr !== 'string'
        || step.expected_stderr.length > 512
        || !step.expected_stderr.startsWith('^')
        || !step.expected_stderr.endsWith('$')
      ) {
        throw new Error('expected_stderr must be an anchored pattern of at most 512 characters');
      }
      try {
        new RegExp(step.expected_stderr);
      } catch {
        throw new Error('expected_stderr must be a valid regular expression');
      }
    }
    if (ids.has(step.id)) throw new Error(`duplicate verification step id: ${step.id}`);
    ids.add(step.id);
  }
  return plan;
}

async function selectedPlan() {
  if (options.plan) {
    return validatePlan(JSON.parse(await readFile(path.resolve(process.cwd(), String(options.plan)), 'utf8')));
  }
  const profile = String(options.profile || 'goal').toLowerCase();
  const plan = structuredClone(BUILTIN_PROFILES[profile]);
  if (!plan) throw new Error(`unknown verification profile: ${profile}`);
  if (profile === 'release' && options.tag) {
    plan.steps.find(({ id }) => id === 'version-check').args.push('--tag', String(options.tag));
  }
  if (profile === 'release' && action === 'run') {
    const requiredSemanticOptions = [
      'requirements', 'binding-requirements', 'matrix', 'reviews', 'review-package',
      'review-lifecycle', 'assurance-accounting',
      'load-bearing-review-obligations', 'attempt-type', 'attempt-id', 'seam-id'
    ];
    const missing = requiredSemanticOptions.filter((name) => !options[name]);
    if (missing.length || options['owner-verified'] !== true) {
      throw new Error(
        `release verification requires exact-head semantic inputs and --owner-verified: ${missing.join(', ') || 'owner verification'}`
      );
    }
    const reviewStep = plan.steps.find(({ id }) => id === 'review-package');
    const conformanceStep = plan.steps.find(({ id }) => id === 'plan-conformance');
    conformanceStep.args.push(
      '--phase', 'release',
      '--requirements', String(options['binding-requirements']),
      '--matrix', String(options.matrix)
    );
    const reviewOptions = [
      'base', 'head', 'requirements', 'binding-requirements', 'matrix',
      'lenses', 'risk-signals', 'intended-claims', 'unavailable-proof',
      'requested-state', 'interfaces', 'attempt-type', 'attempt-id', 'seam-id'
    ];
    for (const name of reviewOptions) {
      if (options[name]) reviewStep.args.push(`--${name}`, String(options[name]));
    }
    const semanticStep = plan.steps.find(({ id }) => id === 'semantic-completion');
    semanticStep.expected_stderr = '^CANDIDATE_COMPLETE review=[A-Za-z0-9._/-]+ claims=[0-9]+\\n?$';
    semanticStep.args.push(
      'complete', '--profile', String(options['semantic-profile'] || 'high-risk'),
      '--owner-verified',
      '--requirements', String(options['binding-requirements']),
      '--matrix', String(options.matrix),
      '--reviews', String(options.reviews),
      '--review-package', String(options['review-package']),
      '--review-lifecycle', String(options['review-lifecycle']),
      '--assurance-accounting', String(options['assurance-accounting']),
      '--load-bearing-review-obligations', String(options['load-bearing-review-obligations']),
      '--release-channel', String(options['release-channel'] || 'public_beta')
    );
    if (options.evidence) semanticStep.args.push('--evidence', String(options.evidence));
    if (options['host-smoke-receipt']) {
      semanticStep.args.push('--host-smoke-receipt', String(options['host-smoke-receipt']));
    }
  }
  return validatePlan(plan);
}

function logText(step, result) {
  return [
    `step: ${step.id}`,
    `command: ${JSON.stringify([step.command, ...step.args])}`,
    `exit_code: ${result.status ?? 1}`,
    '',
    '--- stdout ---',
    String(result.stdout || ''),
    '--- stderr ---',
    String(result.stderr || '')
  ].join('\n');
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function actionable(result, reason) {
  const source = String(result.stderr || result.stdout || reason).trim();
  const line = source.split('\n').filter(Boolean).at(-1) || reason;
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

async function runPlan(plan) {
  const id = randomUUID();
  const runtime = await ensureRuntimeDirectory(root);
  const verification = path.join(runtime, 'verification');
  const logDirectory = path.join(verification, 'logs', id);
  const receiptDirectory = path.join(verification, 'receipts');
  const receiptPath = path.join(receiptDirectory, `${id}.json`);
  await mkdir(logDirectory, { recursive: true });
  await mkdir(receiptDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const steps = [];
  let failedStep = null;
  let actionText = null;
  let warnings = 0;
  let budget = { status: 'not_required' };
  if (plan.complete_suite === true) {
    try {
      const result = await recordExecutionBudgetEvent(runtime, {
        metric: 'complete_suite_executions',
        invalidation: options.invalidation ? String(options.invalidation) : null,
        strategyChange: options['strategy-change'] ? String(options['strategy-change']) : null,
        requiredProof: options['required-proof'] ? String(options['required-proof']) : null,
        requiredProofType: options['required-proof-type']
          ? String(options['required-proof-type'])
          : null,
        requiredProofKind: options['required-proof-kind']
          ? String(options['required-proof-kind'])
          : null,
        requiredProofScope: options['required-proof-scope']
          ? String(options['required-proof-scope'])
          : null,
        requiredProofProfile: options['required-proof-profile']
          ? String(options['required-proof-profile'])
          : null,
        requiredProofCommand: options['required-proof-command']
          ? String(options['required-proof-command'])
          : null
      });
      budget = { status: result.status, ...result.detail };
      if (!result.changed) {
        failedStep = 'execution-budget';
        actionText = `${result.status}: complete-suite execution requires an invalidation or strategy change`;
      }
    } catch (error) {
      if (error.code === 'ENOENT') budget = { status: 'unavailable' };
      else throw error;
    }
  }

  for (const step of plan.steps) {
    if (failedStep) {
      steps.push({ id: step.id, status: 'not_run' });
      continue;
    }
    const started = performance.now();
    const result = spawnSync(step.command, step.args, {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      shell: false,
      maxBuffer: 128 * 1024 * 1024
    });
    const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
    const log = logText(step, result);
    const logPath = path.join(logDirectory, `${step.id}.log`);
    await writeFile(logPath, log);
    const stderr = String(result.stderr || '');
    const expectedStderr = step.expected_stderr
      ? new RegExp(step.expected_stderr).test(stderr)
      : false;
    const unexpectedStderr = (result.status ?? 1) === 0 && stderr.trim() !== '' && !expectedStderr;
    if (unexpectedStderr) warnings += 1;
    const failed = (result.status ?? 1) !== 0 || unexpectedStderr;
    const reason = unexpectedStderr
      ? 'unexpected_stderr'
      : failed
        ? 'nonzero_exit'
        : null;
    steps.push({
      id: step.id,
      command_argv: [step.command, ...step.args],
      command_identity: digest(JSON.stringify([step.command, ...step.args])),
      status: failed ? 'failed' : 'passed',
      reason,
      exit_code: result.status ?? 1,
      duration_ms: durationMs,
      log: logPath,
      log_sha256: digest(log)
    });
    if (failed) {
      failedStep = step.id;
      actionText = actionable(result, reason);
    }
  }

  const endedAt = new Date().toISOString();
  const state = await captureGitState(root);
  const status = failedStep ? 'failed' : 'passed';
  const receipt = {
    schema_version: 1,
    id,
    profile: plan.profile,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    git_commit: state.head,
    git_tree: state.tree,
    dirty_tree_fingerprint: state.dirty_tree_fingerprint,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version
    },
    budget,
    warnings,
    failed_step: failedStep,
    action: actionText,
    steps
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  const summary = {
    schema_version: 1,
    id,
    profile: plan.profile,
    status,
    warnings,
    failed_step: failedStep,
    action: actionText,
    budget,
    steps: steps.map(({ id: stepId, status: stepStatus, reason, duration_ms: duration }) => ({
      id: stepId,
      status: stepStatus,
      ...(reason ? { reason } : {}),
      ...(duration === undefined ? {} : { duration_ms: duration })
    })),
    log_directory: logDirectory,
    receipt: receiptPath
  };
  writeLine(JSON.stringify(summary));
  if (failedStep) process.exitCode = 1;
}

if (action === 'describe') {
  const plan = await selectedPlan();
  writeLine(JSON.stringify({
    profile: plan.profile,
    steps: plan.steps.map(({ id }) => ({ id }))
  }));
} else if (action === 'run') {
  await runPlan(await selectedPlan());
} else {
  throw new Error('Usage: verify.mjs <describe|run> [--profile goal|release] [--plan file]');
}
