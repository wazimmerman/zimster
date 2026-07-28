import { writeSync } from 'node:fs';
import { parseOptions, integerOption, required } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  initializeExecutionBudget,
  normalizeBudgetProfile,
  recordExecutionBudgetEvent,
  satisfyExecutionBudgetProof
} from './lib/execution-budget.mjs';

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
  const { budgetFile, state } = await initializeExecutionBudget(runtime, profile, {
    tokenThreshold,
    overwrite: options.force === true
  });
  emit('BUDGET_INITIALIZED', { profile, limits: state.limits, path: budgetFile });
} else if (action === 'record') {
  const metric = required(options, 'metric');
  const amount = integerOption(options, 'amount', 1);
  const agentId = options['agent-id'] ? String(options['agent-id']) : null;
  const scope = options.scope ? String(options.scope) : null;
  const invalidation = options.invalidation ? String(options.invalidation) : null;
  const strategyChange = options['strategy-change'] ? String(options['strategy-change']) : null;
  const requiredProof = options['required-proof'] ? String(options['required-proof']) : null;
  const result = await recordExecutionBudgetEvent(runtime, {
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
    requiredProofProfile: options['required-proof-profile'] ? String(options['required-proof-profile']) : null
  });
  emit(result.status, result.detail);
  if (['BUDGET_CONSTRAINED', 'BUDGET_PROOF_REQUIRED'].includes(result.status)) {
    process.exitCode = 2;
  }
} else if (action === 'prove') {
  const result = await satisfyExecutionBudgetProof(runtime, {
    proof: required(options, 'proof'),
    receiptId: required(options, 'receipt')
  });
  emit(result.status, result.detail);
} else {
  throw new Error('Usage: run-budget.mjs <init|record|prove> [options]');
}
