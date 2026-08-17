import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  decideConvergence,
  validateConvergenceConfig
} from '../scripts/lib/convergence.mjs';
import { createBudgetState, applyExecutionBudgetEvent } from '../scripts/lib/execution-budget.mjs';
import { root } from './helpers.mjs';

const limits = {
  correction_commits: 2,
  correction_rechecks: 1,
  final_integration_reviews: 2,
  final_verification_attempts: 2,
  complete_suite_executions: 3,
  exact_duplicate_commands: 2,
  context_renewals: 2
};

test('CONV-001: canonical convergence budgets validate and legacy metric aliases remain readable', () => {
  const config = validateConvergenceConfig({
    schema_version: 1,
    autonomous_convergence: { enabled: true, limits }
  });
  const state = createBudgetState('high-risk', { limits: config.autonomous_convergence.limits });
  assert.equal(state.limits.correction_commits, 2);
  assert.equal(state.limits.context_renewals, 2);
  let result = applyExecutionBudgetEvent(state, { metric: 'final_correction_waves' });
  assert.equal(result.status, 'BUDGET_OK');
  assert.equal(state.usage.correction_commits, 1);
  result = applyExecutionBudgetEvent(state, { metric: 'context_compactions' });
  assert.equal(result.status, 'BUDGET_OK');
  assert.equal(state.usage.context_renewals, 1);

  const legacyState = {
    ...structuredClone(state),
    limits: { final_correction_waves: 1, review_rechecks_per_seam: 1, context_compactions: 2 },
    usage: { final_correction_waves: 0, context_compactions: 0 },
    events: [], overrides: [], proof_obligations: [], scoped_usage: {},
    optional_agent_identities: []
  };
  result = applyExecutionBudgetEvent(legacyState, { metric: 'correction_commits' });
  assert.equal(result.status, 'BUDGET_WARNING');
  assert.equal(legacyState.usage.correction_commits, 1);
  assert.equal(legacyState.usage.final_correction_waves, 1);
});

test('CONV-001: correction rechecks cannot consume the reserved exact-head integration review', () => {
  const state = createBudgetState('high-risk', { limits });
  const correction = applyExecutionBudgetEvent(state, {
    metric: 'correction_rechecks',
    scope: 'release-policy'
  });
  assert.equal(correction.status, 'BUDGET_WARNING');
  assert.equal(state.scoped_usage.correction_rechecks['release-policy'], 1);
  assert.equal(state.usage.final_integration_reviews, 0);

  const forbiddenSecondRecheck = applyExecutionBudgetEvent(state, {
    metric: 'correction_rechecks',
    scope: 'release-policy',
    invalidation: 'rename the review attempt',
    strategyChange: 'use a replacement reviewer'
  });
  assert.equal(forbiddenSecondRecheck.status, 'BUDGET_CONSTRAINED');
  assert.equal(state.scoped_usage.correction_rechecks['release-policy'], 1);

  const premature = applyExecutionBudgetEvent(state, {
    metric: 'final_integration_reviews',
    candidateStable: false,
    candidateHead: 'a'.repeat(40)
  });
  assert.equal(premature.status, 'FINAL_REVIEW_RESERVED');
  assert.equal(state.usage.final_integration_reviews, 0);

  const final = applyExecutionBudgetEvent(state, {
    metric: 'final_integration_reviews',
    candidateStable: true,
    candidateHead: 'a'.repeat(40)
  });
  assert.equal(final.status, 'BUDGET_OK');
  assert.equal(state.usage.final_integration_reviews, 1);

  const correctedFinal = applyExecutionBudgetEvent(state, {
    metric: 'final_integration_reviews',
    candidateStable: true,
    candidateHead: 'b'.repeat(40)
  });
  assert.equal(correctedFinal.status, 'BUDGET_WARNING');
  assert.equal(state.usage.final_integration_reviews, 2);
});

test('CONV-001: correction recheck cardinality stays one even when a soft profile limit is higher', () => {
  const state = createBudgetState('high-risk', {
    limits: { ...limits, correction_rechecks: 2 }
  });
  let result = applyExecutionBudgetEvent(state, {
    metric: 'correction_rechecks',
    scope: `whole-release@${'a'.repeat(64)}`
  });
  assert.equal(result.status, 'BUDGET_WARNING');
  result = applyExecutionBudgetEvent(state, {
    metric: 'correction_rechecks',
    scope: `whole-release@${'a'.repeat(64)}`
  });
  assert.equal(result.status, 'BUDGET_CONSTRAINED');
  assert.equal(result.detail.limit, 1);
});

test('CONV-002 and CONV-003: ordinary failures continue through the boundary and exhaustion escalates', () => {
  const base = {
    event: 'focused_test_failure', scope: 'in-scope', sensitivity: 'ordinary',
    reversible: true, authorized: true, deterministic: true, locality: 'local',
    metric: 'correction_commits'
  };
  assert.equal(decideConvergence({ ...base, used: 0, limit: 1 }).outcome, 'continue');
  const exhausted = decideConvergence({ ...base, used: 1, limit: 1 });
  assert.equal(exhausted.outcome, 'budget_exhausted');
  assert.equal(exhausted.reason, 'exhausted_budget');
});

test('CONV-003: only the six binding escalation conditions stop autonomous convergence', () => {
  const common = {
    event: 'focused_test_failure', scope: 'in-scope', sensitivity: 'ordinary',
    reversible: true, authorized: true, deterministic: true, locality: 'local',
    metric: 'correction_commits', used: 0, limit: 1
  };
  const cases = [
    [{ condition: 'contradiction' }, 'contradiction'],
    [{ scope: 'out-of-scope' }, 'material_scope_expansion'],
    [{ sensitivity: 'sensitive', authorized: false }, 'sensitive_decision_lacks_authority'],
    [{ condition: 'missing_independent_review' }, 'missing_independent_review'],
    [{ condition: 'policy_required_approval' }, 'policy_required_approval']
  ];
  for (const [override, reason] of cases) {
    const decision = decideConvergence({ ...common, ...override });
    assert.equal(decision.outcome, 'escalate');
    assert.equal(decision.reason, reason);
  }
});

test('CONV-002: missing or malformed safety facts fail closed', () => {
  const safe = {
    event: 'focused_test_failure', scope: 'in-scope', sensitivity: 'ordinary',
    reversible: true, authorized: true, deterministic: true, locality: 'local',
    metric: 'correction_commits', used: 0, limit: 1
  };
  for (const invalid of [
    { scope: 'nearby' },
    { sensitivity: 'probably-ordinary' },
    { reversible: undefined },
    { authorized: 'true' },
    { deterministic: undefined },
    { locality: 'remote' },
    { condition: 'unknown-condition' }
  ]) assert.throws(() => decideConvergence({ ...safe, ...invalid }), /scope|sensitivity|boolean|locality|condition/i);
  assert.equal(decideConvergence({ ...safe, deterministic: false }).reason, 'policy_required_approval');
  assert.equal(decideConvergence({ ...safe, locality: 'external' }).reason, 'policy_required_approval');
});

test('BOOT-001: run initialization snapshots candidate configuration as isolated and non-authoritative', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-convergence-bootstrap-'));
  const acceptedDirectory = await mkdtemp(path.join(os.tmpdir(), 'zimster-accepted-policy-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const acceptedContents = `${JSON.stringify({
      schema_version: 1,
      autonomous_convergence: { enabled: true, limits }
    }, null, 2)}\n`;
    const acceptedDigest = createHash('sha256').update(acceptedContents).digest('hex');
    await writeFile(path.join(repo, 'README.md'), 'fixture\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: repo }).status, 0);
    const acceptedPolicy = path.join(acceptedDirectory, 'convergence.json');
    await writeFile(acceptedPolicy, acceptedContents);
    let result = spawnSync(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'high-risk',
      '--self-hosting-candidate', '0.6.0', '--convergence-config', 'candidate-policy.json'
    ], { cwd: repo, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /accepted-policy|candidate.*policy|self-host/i);
    result = spawnSync(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'high-risk',
      '--self-hosting-candidate', '0.6.0',
      '--accepted-policy-config', acceptedPolicy,
      '--accepted-policy-sha256', acceptedDigest
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtime = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const receipt = JSON.parse(await readFile(path.join(runtime, 'bootstrap.json'), 'utf8'));
    assert.equal(receipt.governing_policy, 'external_accepted_policy');
    assert.equal(receipt.candidate_rules_authoritative, false);
    assert.equal(receipt.candidate_test_scope, 'isolated_fixtures_and_package_homes');
    assert.equal(receipt.accepted_policy.sha256, acceptedDigest);
    assert.equal(receipt.accepted_policy.path.startsWith(`${repo}${path.sep}`), false);
    const budget = JSON.parse(await readFile(path.join(runtime, 'budget.json'), 'utf8'));
    assert.equal(budget.limits.complete_suite_executions, limits.complete_suite_executions);
    const convergence = spawnSync(process.execPath, [
      path.join(root, 'scripts/convergence.mjs'), 'decide',
      '--event', 'focused_test_failure', '--scope', 'in-scope',
      '--sensitivity', 'ordinary', '--metric', 'correction_commits',
      '--reversible', 'true', '--authorized', 'true',
      '--deterministic', 'true', '--locality', 'local'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(convergence.status, 0, convergence.stderr || convergence.stdout);
    assert.equal(JSON.parse(convergence.stdout).outcome, 'continue');
    const decisions = (await readFile(path.join(runtime, 'convergence/decisions.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(decisions.length, 1);
    const decision = JSON.parse(decisions[0]);
    assert.equal(decision.deterministic, true);
    assert.equal(decision.locality, 'local');
    assert.equal(decision.reversible, true);
    assert.equal(decision.authorized, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(acceptedDirectory, { recursive: true, force: true });
  }
});

test('BOOT-001: convergence preserves module resource identity under Windows path semantics', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-convergence-windows-path-'));
  const loaderDirectory = await mkdtemp(path.join(os.tmpdir(), 'zimster-convergence-loader-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'README.md'), 'fixture\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.equal(spawnSync('git', [
      '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      'commit', '-qm', 'fixture'
    ], { cwd: repo }).status, 0);
    const initialized = spawnSync(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'high-risk'
    ], { cwd: repo, encoding: 'utf8' });
    if (initialized.status !== 0) assert.ifError(initialized.error);
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

    const convergenceUrl = pathToFileURL(path.join(root, 'scripts/convergence.mjs')).href;
    const loader = path.join(loaderDirectory, 'windows-path-loader.mjs');
    await writeFile(loader, `
const target = ${JSON.stringify(convergenceUrl)};
const source = \`import posix from 'node:path/posix';
import win32 from 'node:path/win32';
export default { ...posix, dirname: win32.dirname, resolve: win32.resolve };\`;
const hybrid = \`data:text/javascript,\${encodeURIComponent(source)}\`;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:path' && context.parentURL === target) {
    return { url: hybrid, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`);
    const result = spawnSync(process.execPath, [
      '--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
      path.join(root, 'scripts/convergence.mjs'), 'decide',
      '--event', 'focused_test_failure', '--scope', 'in-scope',
      '--sensitivity', 'ordinary', '--metric', 'correction_commits',
      '--reversible', 'true', '--authorized', 'true',
      '--deterministic', 'true', '--locality', 'local'
    ], { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).outcome, 'continue');
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(loaderDirectory, { recursive: true, force: true });
  }
});
