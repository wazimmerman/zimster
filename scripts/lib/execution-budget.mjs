import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureGitState } from './git-state.mjs';
import { CONVERGENCE_ALIASES, normalizeConvergenceMetric } from './convergence.mjs';

const evidenceScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'evidence.mjs'
);

const convergenceDefaults = JSON.parse(readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'convergence.json'
), 'utf8')).autonomous_convergence.limits;

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  ...convergenceDefaults,
  optional_deliberate_agents: 5,
  nesting_depth: 1,
  research_refreshes: 1,
  final_correction_waves: convergenceDefaults.correction_commits,
  context_compactions: convergenceDefaults.context_renewals
});

export function normalizeBudgetProfile(value) {
  const profile = String(value || '').toLowerCase().replace(/[\s_]+/g, '-');
  if (!['standard', 'high-risk', 'high'].includes(profile)) {
    throw new Error('--profile must be standard or high-risk');
  }
  return profile === 'standard' ? 'standard' : 'high-risk';
}

export function createBudgetState(profile, { tokenThreshold = null, limits = {} } = {}) {
  if (tokenThreshold !== null && (!Number.isInteger(tokenThreshold) || tokenThreshold <= 0)) {
    throw new Error('--token-threshold must be a positive integer');
  }
  const effectiveLimits = { ...DEFAULT_EXECUTION_LIMITS, ...limits };
  for (const [alias, canonical] of Object.entries(CONVERGENCE_ALIASES)) {
    effectiveLimits[alias] = effectiveLimits[canonical];
  }
  const state = {
    schema_version: 1,
    profile: normalizeBudgetProfile(profile),
    limits: effectiveLimits,
    usage: Object.fromEntries(
      Object.keys(effectiveLimits).map((metric) => [metric, 0])
    ),
    optional_agent_identities: [],
    scoped_usage: {},
    overrides: [],
    proof_obligations: [],
    events: []
  };
  if (tokenThreshold !== null) {
    state.limits.observed_tokens = tokenThreshold;
    state.usage.observed_tokens = 0;
  }
  return state;
}

async function writeBudgetAtomically(budgetFile, state) {
  const temporary = `${budgetFile}.temporary-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, budgetFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withBudgetLock(runtimeDirectory, operation) {
  const lock = path.join(runtimeDirectory, 'budget.lock');
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error('execution budget is busy; retry the event');
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function initializeExecutionBudget(runtimeDirectory, profile, options = {}) {
  const state = createBudgetState(profile, options);
  const budgetFile = path.join(runtimeDirectory, 'budget.json');
  await mkdir(path.dirname(budgetFile), { recursive: true });
  if (options.overwrite === true) {
    await writeBudgetAtomically(budgetFile, state);
  } else {
    try {
      await writeFile(budgetFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(`${budgetFile} already exists; pass --force to replace it`);
      }
      throw error;
    }
  }
  return { budgetFile, state };
}

export async function readExecutionBudget(runtimeDirectory) {
  const budgetFile = path.join(runtimeDirectory, 'budget.json');
  return {
    budgetFile,
    state: JSON.parse(await readFile(budgetFile, 'utf8'))
  };
}

export async function writeExecutionBudget(budgetFile, state) {
  await writeBudgetAtomically(budgetFile, state);
}

export async function recordExecutionBudgetEvent(runtimeDirectory, event) {
  return withBudgetLock(runtimeDirectory, async () => {
    const budget = await readExecutionBudget(runtimeDirectory);
    const result = applyExecutionBudgetEvent(budget.state, event);
    if (result.changed) await writeExecutionBudget(budget.budgetFile, budget.state);
    return result;
  });
}

export async function satisfyExecutionBudgetProof(runtimeDirectory, {
  proof,
  receiptId,
  recordedAt = new Date().toISOString()
}) {
  if (!proof) throw new Error('--proof is required');
  if (!/^[a-zA-Z0-9._-]+$/.test(String(receiptId || ''))) {
    throw new Error('--receipt must be a safe receipt id');
  }
  return withBudgetLock(runtimeDirectory, async () => {
    const budget = await readExecutionBudget(runtimeDirectory);
    const obligation = budget.state.proof_obligations.find((row) =>
      row.proof === proof && row.status === 'required'
    );
    if (!obligation) throw new Error(`required proof obligation not found: ${proof}`);
    if (!['verification', 'evidence'].includes(obligation.receipt_type)) {
      throw new Error(`proof obligation has no enforceable receipt relationship: ${proof}`);
    }
    let passed = false;
    if (obligation.receipt_type === 'verification') {
      try {
        const receipt = JSON.parse(await readFile(
        path.join(runtimeDirectory, 'verification', 'receipts', `${receiptId}.json`),
        'utf8'
        ));
        const state = await captureGitState(process.cwd());
        const environment = {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          node: process.version
        };
        passed = receipt.id === receiptId
          && receipt.status === 'passed'
          && (!obligation.profile || receipt.profile === obligation.profile)
          && receipt.git_commit === state.head
          && receipt.git_tree === state.tree
          && receipt.dirty_tree_fingerprint === state.dirty_tree_fingerprint
          && JSON.stringify(receipt.environment || {}) === JSON.stringify(environment);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (obligation.receipt_type === 'evidence') {
      try {
        const rows = (await readFile(
          path.join(runtimeDirectory, 'evidence', 'receipts.jsonl'),
          'utf8'
        )).split('\n').filter(Boolean).map((line) => JSON.parse(line));
        const invalidated = new Set(rows
          .filter((row) => row.record_type === 'invalidation')
          .map((row) => row.receipt_id));
        passed = rows.some((row) =>
          row.id === receiptId
          && row.record_type !== 'invalidation'
          && row.exit_code === 0
          && !invalidated.has(row.id)
          && (!obligation.kind || row.kind === obligation.kind)
          && (!obligation.scope || row.scope === obligation.scope)
          && (!obligation.command || row.command === obligation.command)
        );
        if (passed) {
          const current = spawnSync(process.execPath, [
            evidenceScript, 'check', '--id', receiptId
          ], {
            cwd: process.cwd(),
            encoding: 'utf8',
            shell: false
          });
          passed = current.status === 0;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!passed) {
      throw new Error(
        `passing receipt does not satisfy the required current-tree proof relationship: ${receiptId}`
      );
    }
    obligation.status = 'satisfied';
    obligation.receipt_id = receiptId;
    obligation.satisfied_at = recordedAt;
    await writeExecutionBudget(budget.budgetFile, budget.state);
    return {
      status: 'BUDGET_PROOF_SATISFIED',
      detail: { proof, receipt_id: receiptId }
    };
  });
}

export function applyExecutionBudgetEvent(state, {
  metric,
  amount = 1,
  agentId = null,
  scope = null,
  invalidation = null,
  strategyChange = null,
  requiredProof = null,
  requiredProofType = null,
  requiredProofKind = null,
  requiredProofScope = null,
  requiredProofProfile = null,
  requiredProofCommand = null,
  candidateStable = null,
  candidateHead = null,
  recordedAt = new Date().toISOString()
}) {
  metric = normalizeConvergenceMetric(metric);
  if (!Object.hasOwn(state.limits, metric)) {
    const legacy = Object.entries(CONVERGENCE_ALIASES)
      .find(([alias, canonical]) => canonical === metric && Object.hasOwn(state.limits, alias));
    if (legacy) {
      const [alias] = legacy;
      state.limits[metric] = state.limits[alias];
      state.usage[metric] = state.usage[alias] || 0;
    }
  }
  if (!Object.hasOwn(state.limits, metric)) throw new Error(`unknown budget metric: ${metric}`);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('--amount must be a positive integer');
  if (metric === 'optional_deliberate_agents') {
    if (!agentId) throw new Error('--agent-id is required for optional_deliberate_agents');
    if (state.optional_agent_identities.includes(agentId)) {
      return {
        changed: false,
        status: 'BUDGET_OK',
        detail: {
          metric,
          value: state.usage[metric],
          limit: state.limits[metric],
          duplicate_identity: true
        }
      };
    }
  }
  if (metric === 'correction_rechecks' && !scope) {
    throw new Error('--scope is required for correction_rechecks');
  }
  if (metric === 'final_integration_reviews') {
    if (candidateStable !== true) {
      return {
        changed: false,
        status: 'FINAL_REVIEW_RESERVED',
        detail: { metric, reason: 'candidate head is still changing' }
      };
    }
    if (!/^[0-9a-f]{40}$/.test(candidateHead || '')) {
      throw new Error('final integration review requires an immutable candidate head');
    }
  }
  const scoped = metric === 'correction_rechecks';
  const current = scoped
    ? state.scoped_usage[metric]?.[scope] || 0
    : state.usage[metric] || 0;
  const proposed = current + amount;
  const limit = state.limits[metric];
  if (proposed > limit && !invalidation && !strategyChange) {
    return {
      changed: false,
      status: 'BUDGET_CONSTRAINED',
      detail: { metric, scope, current, proposed, limit }
    };
  }
  if (proposed > limit && !requiredProof) {
    return {
      changed: false,
      status: 'BUDGET_PROOF_REQUIRED',
      detail: { metric, scope, current, proposed, limit }
    };
  }
  if (
    proposed > limit
    && (
      !['verification', 'evidence'].includes(requiredProofType)
      || (requiredProofType === 'verification' && !requiredProofProfile)
      || (requiredProofType === 'evidence' && (
        !requiredProofKind
        || !requiredProofScope
        || !requiredProofCommand
      ))
    )
  ) {
    return {
      changed: false,
      status: 'BUDGET_PROOF_REQUIRED',
      detail: { metric, scope, current, proposed, limit }
    };
  }

  state.usage[metric] = (state.usage[metric] || 0) + amount;
  for (const [alias, canonical] of Object.entries(CONVERGENCE_ALIASES)) {
    if (canonical === metric && Object.hasOwn(state.usage, alias)) state.usage[alias] = state.usage[metric];
  }
  if (scoped) {
    state.scoped_usage[metric] ||= {};
    state.scoped_usage[metric][scope] = proposed;
    for (const [alias, canonical] of Object.entries(CONVERGENCE_ALIASES)) {
      if (canonical !== metric || !Object.hasOwn(state.limits, alias)) continue;
      state.scoped_usage[alias] ||= {};
      state.scoped_usage[alias][scope] = proposed;
    }
  }
  if (agentId) state.optional_agent_identities.push(agentId);
  state.events.push({
    metric,
    scope,
    amount,
    value: proposed,
    recorded_at: recordedAt,
    invalidation,
    strategy_change: strategyChange,
    candidate_head: metric === 'final_integration_reviews' ? candidateHead : null
  });
  if (proposed > limit) {
    state.overrides.push({
      metric,
      scope,
      value: proposed,
      limit,
      invalidation,
      strategy_change: strategyChange,
      required_proof: requiredProof
    });
    state.proof_obligations.push({
      proof: requiredProof,
      status: 'required',
      metric,
      receipt_type: requiredProofType,
      ...(requiredProofKind ? { kind: requiredProofKind } : {}),
      ...(requiredProofScope ? { scope: requiredProofScope } : {}),
      ...(requiredProofProfile ? { profile: requiredProofProfile } : {}),
      ...(requiredProofCommand ? { command: requiredProofCommand } : {})
    });
  }
  return {
    changed: true,
    status: proposed > limit
      ? 'BUDGET_OVERRIDE'
      : proposed === limit
        ? 'BUDGET_WARNING'
        : 'BUDGET_OK',
    detail: { metric, scope, value: proposed, limit }
  };
}
