import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, integerOption, required } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  initializeExecutionBudget,
  normalizeBudgetProfile,
  recordExecutionBudgetEvent,
  satisfyExecutionBudgetProof,
  supersedeExecutionBudgetProof
} from './lib/execution-budget.mjs';
import { validateConvergenceConfig } from './lib/convergence.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);

function emit(status, detail) {
  writeSync(process.stdout.fd, `${JSON.stringify({ status, ...detail })}\n`);
}

if (action === 'init') {
  const profile = normalizeBudgetProfile(required(options, 'profile'));
  const tokenThreshold = integerOption(options, 'token-threshold', null);
  const convergence = options.config
    ? validateConvergenceConfig(JSON.parse(await readFile(path.resolve(root, String(options.config)), 'utf8')))
    : null;
  const { budgetFile, state } = await withControlPlaneMutation(runtime, root, {
    mutationType: 'execution_budget_initialized',
    atomicFailure: true
  }, () => initializeExecutionBudget(runtime, profile, {
    tokenThreshold,
    limits: convergence?.autonomous_convergence.limits,
    overwrite: options.force === true
  }));
  emit('BUDGET_INITIALIZED', { profile, limits: state.limits, path: budgetFile });
} else if (action === 'record') {
  const metric = required(options, 'metric');
  const amount = integerOption(options, 'amount', 1);
  const agentId = options['agent-id'] ? String(options['agent-id']) : null;
  const scope = options.scope ? String(options.scope) : null;
  const invalidation = options.invalidation ? String(options.invalidation) : null;
  const strategyChange = options['strategy-change'] ? String(options['strategy-change']) : null;
  const requiredProof = options['required-proof'] ? String(options['required-proof']) : null;
  const result = await withControlPlaneMutation(runtime, root, {
    mutationType: 'execution_budget_event_recorded',
    didMutate: (value) => value.changed === true,
    atomicFailure: true
  }, () => recordExecutionBudgetEvent(runtime, {
    metric,
    amount,
    agentId,
    scope,
    invalidation,
    strategyChange,
    requiredProof,
    requiredProofType: options['required-proof-type'] ? String(options['required-proof-type']) : null,
    requiredProofKind: options['required-proof-kind'] ? String(options['required-proof-kind']) : null,
    requiredProofScope: options['required-proof-scope'] ? String(options['required-proof-scope']) : null,
    requiredProofProfile: options['required-proof-profile'] ? String(options['required-proof-profile']) : null,
    requiredProofCommand: options['required-proof-command'] ? String(options['required-proof-command']) : null,
    candidateStable: options['candidate-stable'] === true || options['candidate-stable'] === 'true',
    candidateHead: options['candidate-head'] ? String(options['candidate-head']) : null
  }));
  emit(result.status, result.detail);
  if (['BUDGET_CONSTRAINED', 'BUDGET_PROOF_REQUIRED', 'FINAL_REVIEW_RESERVED'].includes(result.status)) {
    process.exitCode = 2;
  }
} else if (action === 'prove') {
  const result = await withControlPlaneMutation(runtime, root, {
    mutationType: 'execution_budget_proof_satisfied',
    atomicFailure: true
  }, () => satisfyExecutionBudgetProof(runtime, {
    proof: required(options, 'proof'),
    receiptId: required(options, 'receipt')
  }));
  emit(result.status, result.detail);
} else if (action === 'supersede') {
  const result = await withControlPlaneMutation(runtime, root, {
    mutationType: 'execution_budget_proof_superseded',
    atomicFailure: true
  }, () => supersedeExecutionBudgetProof(runtime, {
    proof: required(options, 'proof'),
    replacementProof: required(options, 'replacement-proof'),
    reason: required(options, 'reason'),
    requiredProofType: required(options, 'required-proof-type'),
    requiredProofKind: options['required-proof-kind'] ? String(options['required-proof-kind']) : null,
    requiredProofScope: options['required-proof-scope'] ? String(options['required-proof-scope']) : null,
    requiredProofProfile: options['required-proof-profile'] ? String(options['required-proof-profile']) : null,
    requiredProofCommand: options['required-proof-command'] ? String(options['required-proof-command']) : null
  }));
  emit(result.status, result.detail);
} else {
  throw new Error('Usage: run-budget.mjs <init|record|prove|supersede> [options]');
}
