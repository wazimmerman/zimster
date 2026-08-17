import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildMetadata } from './build-metadata.mjs';
import {
  applyExecutionBudgetEvent,
  readExecutionBudget,
  withBudgetLock,
  writeExecutionBudget
} from './execution-budget.mjs';
import { captureGitState, findRepoRoot } from './git-state.mjs';
import { repositoryRelativeIdentity } from './path-identity.mjs';
import { appendRunEvent, readRunState } from './run-state.mjs';
import { refreshRunSummary } from './run-summary.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJsonOptional(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.temporary-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withExecutionLock(runtime, operation) {
  const lock = path.join(runtime, 'executions.lock');
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
  if (!acquired) throw new Error('governed execution state is busy; retry the command');
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function runtimeProvenance(sourceRoot, issuer) {
  const metadata = await buildMetadata(sourceRoot, 'runtime');
  let runtimeOrigin = 'installed_package';
  try {
    const sourceRepo = findRepoRoot(sourceRoot);
    const relative = path.relative(sourceRepo, sourceRoot).split(path.sep).join('/');
    runtimeOrigin = relative === 'plugins/zimster'
      ? 'generated_mirror'
      : relative === ''
        ? 'source_checkout'
        : 'source_checkout_subpath';
  } catch {
    const embedded = await readJsonOptional(path.join(
      sourceRoot,
      'skills',
      'using-zimster',
      'references',
      'build-metadata.json'
    ));
    runtimeOrigin = embedded?.package_target
      ? `installed_${embedded.package_target}`
      : 'installed_package';
  }
  return { ...metadata, runtime_origin: runtimeOrigin, issuer };
}

async function governingPolicy(runtime) {
  const bootstrap = await readJsonOptional(path.join(runtime, 'bootstrap.json'));
  if (!bootstrap) {
    return {
      mode: 'runtime_policy',
      runtime_role: 'governing_runtime',
      candidate_rules_authoritative: true,
      accepted_policy: null
    };
  }
  return {
    mode: bootstrap.governing_policy,
    runtime_role: bootstrap.candidate_rules_authoritative === false
      ? 'candidate_under_test'
      : 'governing_runtime',
    candidate_rules_authoritative: bootstrap.candidate_rules_authoritative !== false,
    accepted_policy: bootstrap.accepted_policy || null,
    candidate_version: bootstrap.candidate_version || null
  };
}

export async function executionReceipts(runtime) {
  const directory = path.join(runtime, 'executions', 'receipts');
  let files;
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const receipts = await Promise.all(files.map(async (file) =>
    JSON.parse(await readFile(path.join(directory, file), 'utf8'))
  ));
  let events;
  try {
    events = (await readFile(path.join(runtime, 'executions', 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') events = [];
    else throw error;
  }
  return receipts.filter((receipt) => {
    const starts = events.filter((row) =>
      row.event_type === 'execution_started' && row.execution_id === receipt.id
    );
    return starts.length === 1
      && starts[0].issuer === receipt.issuer
      && starts[0].command_identity === receipt.command_identity
      && starts[0].complete_suite === receipt.complete_suite
      && JSON.stringify(starts[0].candidate) === JSON.stringify(receipt.candidate);
  });
}

function observedFromReceipts(receipts) {
  const ordered = [...receipts].sort((left, right) =>
    String(left.started_at).localeCompare(String(right.started_at)) || left.id.localeCompare(right.id)
  );
  const groups = new Map();
  for (const receipt of ordered) {
    const rows = groups.get(receipt.command_identity) || [];
    rows.push(receipt);
    groups.set(receipt.command_identity, rows);
  }
  const duplicateReceipts = [...groups.values()].flatMap((rows) => rows.slice(1));
  const suites = ordered.filter(({ complete_suite }) => complete_suite === true);
  return {
    complete_suite_executions: suites.length,
    exact_duplicate_commands: duplicateReceipts.length,
    supporting_execution_ids: {
      complete_suite_executions: suites.map(({ id }) => id),
      exact_duplicate_commands: duplicateReceipts.map(({ id }) => id)
    }
  };
}

export async function observedExecutionAccounting(runtime) {
  return observedFromReceipts(await executionReceipts(runtime));
}

async function appendExecutionEvent(runtime, event) {
  const directory = path.join(runtime, 'executions');
  await mkdir(directory, { recursive: true });
  const row = {
    schema_version: 1,
    recorded_at: new Date().toISOString(),
    ...event
  };
  await appendFile(path.join(directory, 'events.jsonl'), `${JSON.stringify(row)}\n`);
  return row;
}

async function accountingReport(runtime, repo, { mutate = false, reason = null } = {}) {
  const receipts = await executionReceipts(runtime);
  const observed = observedFromReceipts(receipts);
  const budgetFile = path.join(runtime, 'budget.json');
  const budget = await readJsonOptional(budgetFile);
  if (!budget) {
    return {
      schema_version: 1,
      status: 'ACCOUNTING_UNVERIFIED',
      reason: 'budget.json is unavailable',
      observed: {
        complete_suite_executions: observed.complete_suite_executions,
        exact_duplicate_commands: observed.exact_duplicate_commands
      },
      corrections: [],
      supporting_execution_ids: observed.supporting_execution_ids,
      unobserved_direct_shell_commands: 'not_observable'
    };
  }
  const corrections = [];
  for (const metric of ['complete_suite_executions', 'exact_duplicate_commands']) {
    const prior = budget.usage?.[metric];
    const value = observed[metric];
    if (prior !== value) {
      corrections.push({
        metric,
        prior_value: prior ?? null,
        observed_value: value,
        corrected_value: value,
        supporting_execution_ids: observed.supporting_execution_ids[metric],
        reason: reason || 'governed execution receipts outrank a stale projected counter'
      });
    }
  }
  if (mutate) {
    budget.usage ||= {};
    for (const metric of ['complete_suite_executions', 'exact_duplicate_commands']) {
      budget.usage[metric] = observed[metric];
    }
    budget.accounting_status = 'current';
    budget.accounting_basis = {
      schema_version: 1,
      execution_ids: receipts.map(({ id }) => id).sort(),
      execution_set_sha256: digest(JSON.stringify(receipts.map(({ id }) => id).sort()))
    };
    await writeJsonAtomic(budgetFile, budget);
    const candidate = await captureGitState(repo);
    for (const correction of corrections) {
      await appendRunEvent(runtime, {
        event_type: 'accounting_reconciled',
        ...correction,
        candidate: {
          head: candidate.head,
          tree: candidate.tree,
          dirty_tree_fingerprint: candidate.dirty_tree_fingerprint
        }
      });
    }
    if (await readRunState(runtime)) await refreshRunSummary(runtime, { repo });
  }
  return {
    schema_version: 1,
    status: corrections.length
      ? (mutate ? 'ACCOUNTING_RECONCILED' : 'STALE_ACCOUNTING')
      : 'ACCOUNTING_CURRENT',
    observed: {
      complete_suite_executions: observed.complete_suite_executions,
      exact_duplicate_commands: observed.exact_duplicate_commands
    },
    corrections,
    supporting_execution_ids: observed.supporting_execution_ids,
    unobserved_direct_shell_commands: 'not_observable'
  };
}

export async function reconcileExecutionAccounting(runtime, repo, options = {}) {
  if (options.mutate === false) return accountingReport(runtime, repo, options);
  return withBudgetLock(runtime, () => accountingReport(runtime, repo, {
    ...options,
    mutate: true
  }));
}

async function admitMetrics(runtime, metrics, override = {}) {
  if (!metrics.length) return { admitted: true, status: 'BUDGET_OK', metrics: [] };
  try {
    return await withBudgetLock(runtime, async () => {
      const budget = await readExecutionBudget(runtime);
      const proposed = structuredClone(budget.state);
      const results = [];
      for (const metric of metrics) {
        const result = applyExecutionBudgetEvent(proposed, {
          metric,
          invalidation: override.invalidation,
          strategyChange: override.strategyChange,
          requiredProof: override.requiredProof,
          requiredProofType: override.requiredProofType,
          requiredProofKind: override.requiredProofKind,
          requiredProofScope: override.requiredProofScope,
          requiredProofProfile: override.requiredProofProfile,
          requiredProofCommand: override.requiredProofCommand
        });
        results.push({ status: result.status, ...result.detail });
        if (!result.changed) {
          return { admitted: false, status: result.status, ...result.detail, metrics: results };
        }
      }
      await writeExecutionBudget(budget.budgetFile, proposed);
      const rank = ['BUDGET_OK', 'BUDGET_WARNING', 'BUDGET_OVERRIDE'];
      const status = results.reduce((selected, row) =>
        rank.indexOf(row.status) > rank.indexOf(selected) ? row.status : selected
      , 'BUDGET_OK');
      return { admitted: true, status, metrics: results };
    });
  } catch (error) {
    if (error.code === 'ENOENT') return { admitted: true, status: 'unavailable', metrics: [] };
    throw error;
  }
}

export async function beginGovernedExecution(runtime, repo, {
  sourceRoot,
  issuer,
  commandArgv,
  cwd = repo,
  profile = null,
  context = null,
  completeSuite = false,
  budgetOverride = {}
}) {
  if (!Array.isArray(commandArgv) || !commandArgv.length || !commandArgv.every((item) => typeof item === 'string')) {
    throw new Error('governed execution requires an exact command argv');
  }
  return withExecutionLock(runtime, async () => {
    const existing = await executionReceipts(runtime);
    const candidate = await captureGitState(repo);
    const cwdIdentity = await repositoryRelativeIdentity(repo, cwd);
    const commandIdentity = digest(JSON.stringify({
      argv: commandArgv,
      cwd: cwdIdentity,
      profile,
      context,
      candidate: {
        head: candidate.head,
        tree: candidate.tree,
        dirty_tree_fingerprint: candidate.dirty_tree_fingerprint
      }
    }));
    const duplicates = existing.filter((row) => row.command_identity === commandIdentity).length;
    const metrics = [
      ...(completeSuite ? ['complete_suite_executions'] : []),
      ...(duplicates > 0 ? ['exact_duplicate_commands'] : [])
    ];
    const budget = await admitMetrics(runtime, metrics, budgetOverride);
    if (!budget.admitted) return { admitted: false, budget };
    const run = await readRunState(runtime);
    const receipt = {
      schema_version: 1,
      id: randomUUID(),
      run_id: run?.id || null,
      issuer,
      status: 'running',
      started_at: new Date().toISOString(),
      ended_at: null,
      command_argv: commandArgv,
      command_identity: commandIdentity,
      cwd: cwdIdentity,
      profile,
      context,
      complete_suite: completeSuite === true,
      duplicate_ordinal: duplicates + 1,
      candidate: {
        head: candidate.head,
        tree: candidate.tree,
        dirty_tree_fingerprint: candidate.dirty_tree_fingerprint
      },
      environment: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        node: process.version
      },
      runtime_provenance: await runtimeProvenance(sourceRoot, issuer),
      governing_policy: await governingPolicy(runtime),
      terminal_receipt_type: null,
      terminal_receipt_id: null,
      terminal_receipt_sha256: null,
      exit_code: null,
      compact_result: null
    };
    await writeJsonAtomic(path.join(runtime, 'executions', 'receipts', `${receipt.id}.json`), receipt);
    await appendExecutionEvent(runtime, {
      event_type: 'execution_started',
      execution_id: receipt.id,
      issuer,
      command_identity: commandIdentity,
      complete_suite: receipt.complete_suite,
      duplicate_ordinal: receipt.duplicate_ordinal,
      candidate: receipt.candidate
    });
    await appendRunEvent(runtime, {
      event_type: 'governed_execution_started',
      execution_id: receipt.id,
      issuer,
      command_identity: commandIdentity
    });
    await reconcileExecutionAccounting(runtime, repo, {
      mutate: true,
      reason: 'governed execution started durably before command spawn'
    });
    return { admitted: true, receipt, budget };
  });
}

export async function finishGovernedExecution(runtime, repo, {
  executionId,
  status,
  exitCode,
  terminalReceiptType,
  terminalReceiptId,
  terminalReceiptBytes,
  compactResult = null
}) {
  return withExecutionLock(runtime, async () => {
    const file = path.join(runtime, 'executions', 'receipts', `${executionId}.json`);
    const receipt = await readJsonOptional(file);
    if (!receipt) throw new Error(`governed execution receipt not found: ${executionId}`);
    if (receipt.status !== 'running') throw new Error(`governed execution ${executionId} is already terminal`);
    receipt.status = status;
    receipt.ended_at = new Date().toISOString();
    receipt.exit_code = exitCode;
    receipt.terminal_receipt_type = terminalReceiptType;
    receipt.terminal_receipt_id = terminalReceiptId;
    receipt.terminal_receipt_sha256 = digest(terminalReceiptBytes);
    receipt.compact_result = compactResult;
    await writeJsonAtomic(file, receipt);
    await appendExecutionEvent(runtime, {
      event_type: 'execution_finished',
      execution_id: executionId,
      issuer: receipt.issuer,
      status,
      exit_code: exitCode,
      terminal_receipt_type: terminalReceiptType,
      terminal_receipt_id: terminalReceiptId,
      terminal_receipt_sha256: receipt.terminal_receipt_sha256
    });
    await appendRunEvent(runtime, {
      event_type: 'governed_execution_finished',
      execution_id: executionId,
      status,
      terminal_receipt_id: terminalReceiptId
    });
    await reconcileExecutionAccounting(runtime, repo, { mutate: true });
    return receipt;
  });
}

export function terminalReceiptDigest(bytes) {
  return digest(bytes);
}
