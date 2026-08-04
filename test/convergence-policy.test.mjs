import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  decideConvergence,
  validateConvergenceConfig
} from '../scripts/lib/convergence.mjs';
import { createBudgetState, applyExecutionBudgetEvent } from '../scripts/lib/execution-budget.mjs';
import { root } from './helpers.mjs';

const limits = {
  correction_commits: 1,
  review_rechecks_per_seam: 1,
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
  assert.equal(state.limits.correction_commits, 1);
  assert.equal(state.limits.context_renewals, 2);
  let result = applyExecutionBudgetEvent(state, { metric: 'final_correction_waves' });
  assert.equal(result.status, 'BUDGET_WARNING');
  assert.equal(state.usage.correction_commits, 1);
  result = applyExecutionBudgetEvent(state, { metric: 'context_compactions' });
  assert.equal(result.status, 'BUDGET_OK');
  assert.equal(state.usage.context_renewals, 1);
});

test('CONV-002 and CONV-003: ordinary failures continue through the boundary and exhaustion escalates', () => {
  const base = {
    event: 'focused_test_failure', scope: 'in-scope', sensitivity: 'ordinary',
    reversible: true, authorized: true, metric: 'correction_commits'
  };
  assert.equal(decideConvergence({ ...base, used: 0, limit: 1 }).outcome, 'continue');
  const exhausted = decideConvergence({ ...base, used: 1, limit: 1 });
  assert.equal(exhausted.outcome, 'budget_exhausted');
  assert.equal(exhausted.reason, 'exhausted_budget');
});

test('CONV-003: only the six binding escalation conditions stop autonomous convergence', () => {
  const common = {
    event: 'focused_test_failure', scope: 'in-scope', sensitivity: 'ordinary',
    reversible: true, authorized: true, metric: 'correction_commits', used: 0, limit: 1
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

test('BOOT-001: run initialization snapshots candidate configuration as isolated and non-authoritative', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-convergence-bootstrap-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'README.md'), 'fixture\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: repo }).status, 0);
    const result = spawnSync(process.execPath, [
      path.join(root, 'scripts/init-run.mjs'), '--profile', 'high-risk',
      '--self-hosting-candidate', '0.6.0'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtime = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'zimster'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const receipt = JSON.parse(await readFile(path.join(runtime, 'bootstrap.json'), 'utf8'));
    assert.equal(receipt.governing_policy, 'frozen_checked_in_policy');
    assert.equal(receipt.candidate_rules_authoritative, false);
    assert.equal(receipt.candidate_test_scope, 'isolated_fixtures_and_package_homes');
    const convergence = spawnSync(process.execPath, [
      path.join(root, 'scripts/convergence.mjs'), 'decide',
      '--event', 'focused_test_failure', '--scope', 'in-scope',
      '--sensitivity', 'ordinary', '--metric', 'correction_commits'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(convergence.status, 0, convergence.stderr || convergence.stdout);
    assert.equal(JSON.parse(convergence.stdout).outcome, 'continue');
    const decisions = (await readFile(path.join(runtime, 'convergence/decisions.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(decisions.length, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
