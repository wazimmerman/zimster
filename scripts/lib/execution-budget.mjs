import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMetadata } from './build-metadata.mjs';
import { captureGitState } from './git-state.mjs';
import {
  CONVERGENCE_ALIASES,
  normalizeConvergenceMetric,
  validateConvergenceConfig
} from './convergence.mjs';

const evidenceScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'evidence.mjs'
);
const runtimeSourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..'
);

const convergenceDefaults = JSON.parse(readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'convergence.json'
), 'utf8')).autonomous_convergence.limits;

async function readJsonOptional(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

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
    proof_identity_reconciliations: [],
    events: []
  };
  if (tokenThreshold !== null) {
    state.limits.observed_tokens = tokenThreshold;
    state.usage.observed_tokens = 0;
  }
  return state;
}

export function duplicateExecutionBudgetProofIdentities(state) {
  const counts = new Map();
  for (const row of state?.proof_obligations || []) {
    if (typeof row.proof !== 'string' || !row.proof) continue;
    counts.set(row.proof, (counts.get(row.proof) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([proof]) => proof)
    .sort();
}

function proofFingerprint(row) {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

export function analyzeExecutionBudgetProofIdentities(state) {
  const obligations = state?.proof_obligations || [];
  const groups = new Map();
  obligations.forEach((row, index) => {
    if (typeof row.proof !== 'string' || !row.proof) return;
    const rows = groups.get(row.proof) || [];
    rows.push({ row, index, occurrence: rows.length });
    groups.set(row.proof, rows);
  });
  const reconciliations = new Map();
  const issues = [];
  for (const reconciliation of state?.proof_identity_reconciliations || []) {
    if (!reconciliation || typeof reconciliation.proof !== 'string') {
      issues.push('proof identity reconciliation is malformed');
      continue;
    }
    if (reconciliations.has(reconciliation.proof)) {
      issues.push(`duplicate proof identity reconciliation: ${reconciliation.proof}`);
      continue;
    }
    reconciliations.set(reconciliation.proof, reconciliation);
  }
  for (const [proof, rows] of groups) {
    if (rows.length < 2) continue;
    const reconciliation = reconciliations.get(proof);
    if (!reconciliation) {
      issues.push(`duplicate proof identity is ambiguous: ${proof}`);
      continue;
    }
    const fingerprints = rows.map(({ row }) => proofFingerprint(row));
    if (JSON.stringify(reconciliation.occurrence_fingerprints) !== JSON.stringify(fingerprints)) {
      issues.push(`proof identity reconciliation no longer matches its occurrences: ${proof}`);
    }
  }
  function resolve(proof, sourceType, sourceIndex) {
    const rows = groups.get(proof) || [];
    if (rows.length === 1) return rows[0].index;
    if (rows.length === 0) return null;
    const reconciliation = reconciliations.get(proof);
    if (!reconciliation) return null;
    const binding = (reconciliation.bindings || []).find((row) =>
      row.source_type === sourceType && row.source_index === sourceIndex
    );
    if (!binding || !Number.isInteger(binding.target_occurrence)
      || binding.target_occurrence < 0 || binding.target_occurrence >= rows.length) {
      issues.push(
        `ambiguous proof reference lacks an occurrence binding: ${sourceType}[${sourceIndex}] -> ${proof}`
      );
      return null;
    }
    return rows[binding.target_occurrence].index;
  }
  return { issues, resolve };
}

export async function reconcileExecutionBudgetProofIdentities(runtimeDirectory, {
  proof,
  bindings,
  reason,
  recordedAt = new Date().toISOString()
}) {
  if (typeof proof !== 'string' || !proof) throw new Error('--proof is required');
  if (!Array.isArray(bindings) || !bindings.length) {
    throw new Error('--bindings must be a non-empty JSON array');
  }
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('--reason is required');
  return withBudgetLock(runtimeDirectory, async () => {
    const budget = await readExecutionBudget(runtimeDirectory);
    budget.state.proof_identity_reconciliations ||= [];
    if (budget.state.proof_identity_reconciliations.some((row) => row.proof === proof)) {
      throw new Error(`proof identity is already reconciled: ${proof}`);
    }
    const rows = budget.state.proof_obligations.filter((row) => row.proof === proof);
    if (rows.length < 2) throw new Error(`duplicate proof identity not found: ${proof}`);
    if (rows.some((row) => row.status === 'required')) {
      throw new Error('duplicate proof identities must be terminal before reconciliation');
    }
    const normalizedBindings = bindings.map((binding) => {
      if (!binding || !['override', 'supersession'].includes(binding.source_type)
        || !Number.isInteger(binding.source_index) || binding.source_index < 0
        || !Number.isInteger(binding.target_occurrence)
        || binding.target_occurrence < 0 || binding.target_occurrence >= rows.length) {
        throw new Error('each binding requires source_type, source_index, and valid target_occurrence');
      }
      return {
        source_type: binding.source_type,
        source_index: binding.source_index,
        target_occurrence: binding.target_occurrence
      };
    });
    budget.state.proof_identity_reconciliations.push({
      proof,
      occurrence_fingerprints: rows.map(proofFingerprint),
      bindings: normalizedBindings,
      reason: reason.trim(),
      recorded_at: recordedAt
    });
    const analysis = analyzeExecutionBudgetProofIdentities(budget.state);
    const relatedIssues = analysis.issues.filter((issue) => issue.includes(proof));
    for (const [index, override] of budget.state.overrides.entries()) {
      if (override.required_proof === proof) analysis.resolve(proof, 'override', index);
    }
    for (const [index, obligation] of budget.state.proof_obligations.entries()) {
      if (obligation.superseded_by === proof) analysis.resolve(proof, 'supersession', index);
    }
    relatedIssues.push(...analysis.issues.filter((issue) =>
      issue.includes(`-> ${proof}`) && !relatedIssues.includes(issue)
    ));
    if (relatedIssues.length) throw new Error(relatedIssues.join('; '));
    await writeExecutionBudget(budget.budgetFile, budget.state);
    return {
      status: 'BUDGET_PROOF_IDENTITIES_RECONCILED',
      detail: { proof, occurrences: rows.length, bindings: normalizedBindings.length }
    };
  });
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

export async function withBudgetLock(runtimeDirectory, operation) {
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
    const diagnostics = {};
    const passed = await executionBudgetProofReceiptPasses(
      runtimeDirectory,
      obligation,
      receiptId,
      { diagnostics }
    );
    if (!passed) {
      throw new Error(
        `trusted governed receipt must satisfy the current-tree relationship and precede the override; circular, handcrafted, or postdated proof is rejected: ${receiptId} (${JSON.stringify(diagnostics)})`
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

export async function executionBudgetProofReceiptPasses(
  runtimeDirectory,
  obligation,
  receiptId,
  { cwd = process.cwd(), diagnostics = null } = {}
) {
  if (!obligation.required_at || Number.isNaN(Date.parse(obligation.required_at))) {
    if (diagnostics) diagnostics.reason = 'missing_required_at';
    return false;
  }
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  async function governedReceiptPasses(terminalReceipt, terminalBytes, expectedType) {
    const expectedIssuer = expectedType === 'verification'
      ? 'zimster.verify'
      : 'zimster.evidence';
    if (
      terminalReceipt.issuer !== expectedIssuer
      || !/^[0-9a-f-]{36}$/.test(String(terminalReceipt.execution_id || ''))
    ) {
      if (diagnostics) {
        diagnostics.reason = 'untrusted_terminal_issuer';
        diagnostics.issuer = terminalReceipt.issuer || null;
        diagnostics.execution_id = terminalReceipt.execution_id || null;
      }
      return false;
    }
    let execution;
    try {
      execution = JSON.parse(await readFile(
        path.join(runtimeDirectory, 'executions', 'receipts', `${terminalReceipt.execution_id}.json`),
        'utf8'
      ));
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (diagnostics) diagnostics.reason = 'missing_execution_receipt';
        return false;
      }
      throw error;
    }
    let executionEvents;
    try {
      executionEvents = (await readFile(
        path.join(runtimeDirectory, 'executions', 'events.jsonl'),
        'utf8'
      )).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') executionEvents = [];
      else throw error;
    }
    const starts = executionEvents.filter((row) =>
      row.event_type === 'execution_started' && row.execution_id === execution.id
    );
    const finishes = executionEvents.filter((row) =>
      row.event_type === 'execution_finished' && row.execution_id === execution.id
    );
    const terminalCandidate = {
      head: terminalReceipt.git_commit || terminalReceipt.git_head,
      tree: terminalReceipt.git_tree,
      dirty_tree_fingerprint: terminalReceipt.dirty_tree_fingerprint
    };
    const bootstrap = await readJsonOptional(path.join(runtimeDirectory, 'bootstrap.json'));
    const trustedRuntime = await buildMetadata(runtimeSourceRoot, 'runtime');
    const expectedPolicy = bootstrap
      ? {
          mode: bootstrap.governing_policy,
          runtime_role: bootstrap.candidate_rules_authoritative === false
            ? 'candidate_under_test'
            : 'governing_runtime',
          candidate_rules_authoritative: bootstrap.candidate_rules_authoritative !== false,
          accepted_policy: bootstrap.accepted_policy || null,
          candidate_version: bootstrap.candidate_version || null
        }
      : {
          mode: 'runtime_policy',
          runtime_role: 'governing_runtime',
          candidate_rules_authoritative: true,
          accepted_policy: null
        };
    let acceptedPolicyAuthenticated = !bootstrap;
    if (bootstrap) {
      const accepted = bootstrap.accepted_policy;
      if (
        bootstrap.governing_policy === 'external_accepted_policy'
        && bootstrap.candidate_rules_authoritative === false
        && accepted
        && typeof accepted.path === 'string'
        && /^[0-9a-f]{64}$/.test(String(accepted.sha256 || ''))
      ) {
        try {
          const acceptedBytes = await readFile(path.resolve(accepted.path));
          validateConvergenceConfig(JSON.parse(acceptedBytes.toString('utf8')));
          acceptedPolicyAuthenticated = createHash('sha256')
            .update(acceptedBytes).digest('hex') === accepted.sha256;
          if (acceptedPolicyAuthenticated && accepted.immutable_source) {
            const source = accepted.immutable_source;
            const object = source.kind === 'git_object'
              && /^[0-9a-f]{40}$/.test(String(source.commit || ''))
              && typeof source.path === 'string'
              ? spawnSync('git', ['show', `${source.commit}:${source.path}`], {
                  cwd,
                  encoding: 'buffer',
                  maxBuffer: 4 * 1024 * 1024
                })
              : { status: 1 };
            const ancestor = source.kind === 'git_object'
              ? spawnSync('git', [
                  'merge-base', '--is-ancestor', source.commit, terminalCandidate.head
                ], { cwd, encoding: 'utf8' })
              : { status: 1 };
            acceptedPolicyAuthenticated = object.status === 0
              && ancestor.status === 0
              && createHash('sha256').update(object.stdout).digest('hex') === accepted.sha256
              && path.resolve(accepted.path).startsWith(
                `${path.resolve(runtimeDirectory, 'accepted-policy')}${path.sep}`
              );
          } else if (acceptedPolicyAuthenticated) {
            const relative = path.relative(cwd, path.resolve(accepted.path));
            acceptedPolicyAuthenticated = relative === '..'
              || relative.startsWith(`..${path.sep}`);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          acceptedPolicyAuthenticated = false;
        }
      }
    }
    const relationships = {
      execution_id: execution.id === terminalReceipt.execution_id,
      issuer: execution.issuer === terminalReceipt.issuer,
      passed: execution.status === 'passed' && execution.exit_code === 0,
      terminal_type: execution.terminal_receipt_type === expectedType,
      terminal_id: execution.terminal_receipt_id === terminalReceipt.id,
      terminal_digest: execution.terminal_receipt_sha256 === sha256(terminalBytes),
      timestamps: !Number.isNaN(Date.parse(execution.started_at))
        && !Number.isNaN(Date.parse(execution.ended_at))
        && Date.parse(execution.started_at) <= Date.parse(execution.ended_at),
      non_circular: Date.parse(execution.ended_at) <= Date.parse(obligation.required_at),
      candidate: /^[0-9a-f]{40}$/.test(String(execution.candidate?.head || ''))
        && /^[0-9a-f]{40}$/.test(String(execution.candidate?.tree || ''))
        && /^[0-9a-f]{64}$/.test(String(execution.candidate?.dirty_tree_fingerprint || '')),
      candidate_match: JSON.stringify(execution.candidate) === JSON.stringify(terminalCandidate),
      environment: ['platform', 'release', 'arch', 'node'].every((name) =>
        execution.environment?.[name] === terminalReceipt.environment?.[name]
      ),
      provenance: execution.runtime_provenance?.semantic_version === trustedRuntime.semantic_version
        && execution.runtime_provenance?.source_commit === trustedRuntime.source_commit
        && execution.runtime_provenance?.source_tree === trustedRuntime.source_tree
        && execution.runtime_provenance?.source_dirty_tree_fingerprint
          === trustedRuntime.source_dirty_tree_fingerprint
        && typeof execution.runtime_provenance?.runtime_origin === 'string'
        && execution.runtime_provenance.runtime_origin.length > 0
        && execution.runtime_provenance?.issuer === execution.issuer,
      governing_policy: JSON.stringify(execution.governing_policy) === JSON.stringify(expectedPolicy)
        && acceptedPolicyAuthenticated,
      ledger_start: starts.length === 1
        && starts[0].issuer === execution.issuer
        && starts[0].command_identity === execution.command_identity
        && starts[0].complete_suite === execution.complete_suite
        && JSON.stringify(starts[0].candidate) === JSON.stringify(execution.candidate),
      ledger_finish: finishes.length === 1
        && finishes[0].issuer === execution.issuer
        && finishes[0].status === execution.status
        && finishes[0].exit_code === execution.exit_code
        && finishes[0].terminal_receipt_type === execution.terminal_receipt_type
        && finishes[0].terminal_receipt_id === execution.terminal_receipt_id
        && finishes[0].terminal_receipt_sha256 === execution.terminal_receipt_sha256
    };
    const valid = Object.values(relationships).every(Boolean);
    if (!valid && diagnostics) {
      diagnostics.reason = 'governed_execution_relationship';
      diagnostics.relationships = relationships;
    }
    return valid;
  }
  let passed = false;
  if (obligation.receipt_type === 'verification') {
    try {
      const receiptBytes = await readFile(
        path.join(runtimeDirectory, 'verification', 'receipts', `${receiptId}.json`),
        'utf8'
      );
      const receipt = JSON.parse(receiptBytes);
      const state = await captureGitState(cwd);
      const environment = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        node: process.version
      };
      const terminalRelationships = {
        receipt_id: receipt.id === receiptId,
        passed: receipt.status === 'passed',
        profile: !obligation.profile || receipt.profile === obligation.profile,
        head: receipt.git_commit === state.head,
        tree: receipt.git_tree === state.tree,
        dirty_tree: receipt.dirty_tree_fingerprint === state.dirty_tree_fingerprint,
        environment: JSON.stringify(receipt.environment || {}) === JSON.stringify(environment)
      };
      const validTerminal = Object.values(terminalRelationships).every(Boolean);
      if (!validTerminal && diagnostics) {
        diagnostics.reason = 'terminal_receipt_relationship';
        diagnostics.relationships = terminalRelationships;
      }
      passed = validTerminal && await governedReceiptPasses(receipt, receiptBytes, 'verification');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (diagnostics) diagnostics.reason = 'missing_verification_receipt';
    }
  }
  if (obligation.receipt_type === 'evidence') {
    try {
      const state = await captureGitState(cwd);
      const rawRows = (await readFile(
        path.join(runtimeDirectory, 'evidence', 'receipts.jsonl'),
        'utf8'
      )).split('\n').filter(Boolean);
      const rows = rawRows.map((line) => JSON.parse(line));
      const invalidated = new Set(rows
        .filter((row) => row.record_type === 'invalidation')
        .map((row) => row.receipt_id));
      const receipt = rows.find((row) =>
        row.id === receiptId
        && row.record_type !== 'invalidation'
        && row.exit_code === 0
        && (row.git_commit || row.git_head) === state.head
        && row.git_tree === state.tree
        && !invalidated.has(row.id)
        && (!obligation.kind || row.kind === obligation.kind)
        && (!obligation.scope || row.scope === obligation.scope)
        && (!obligation.command || row.command === obligation.command)
      );
      const receiptLine = receipt
        ? rawRows.find((line) => JSON.parse(line).id === receipt.id)
        : null;
      passed = Boolean(receipt)
        && await governedReceiptPasses(receipt, `${receiptLine}\n`, 'evidence');
      if (passed) {
        const current = spawnSync(process.execPath, [
          evidenceScript, 'check', '--id', receiptId
        ], {
          cwd,
          encoding: 'utf8',
          shell: false
        });
        passed = current.status === 0;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return passed;
}

export async function supersedeExecutionBudgetProof(runtimeDirectory, {
  proof,
  replacementProof,
  reason,
  requiredProofType,
  requiredProofKind = null,
  requiredProofScope = null,
  requiredProofProfile = null,
  requiredProofCommand = null,
  recordedAt = new Date().toISOString()
}) {
  if (!proof || !replacementProof || !reason) {
    throw new Error('--proof, --replacement-proof, and --reason are required');
  }
  if (proof === replacementProof) throw new Error('replacement proof must have a new stable identity');
  if (!['verification', 'evidence'].includes(requiredProofType)
    || (requiredProofType === 'verification' && !requiredProofProfile)
    || (requiredProofType === 'evidence'
      && (!requiredProofKind || !requiredProofScope || !requiredProofCommand))) {
    throw new Error('replacement proof requires an enforceable verification or evidence relationship');
  }
  return withBudgetLock(runtimeDirectory, async () => {
    const budget = await readExecutionBudget(runtimeDirectory);
    const obligation = budget.state.proof_obligations.find((row) =>
      row.proof === proof && ['required', 'satisfied'].includes(row.status)
    );
    if (!obligation) throw new Error(`renewable proof obligation not found: ${proof}`);
    if (budget.state.proof_obligations.some((row) => row.proof === replacementProof)) {
      throw new Error(`replacement proof identity already exists: ${replacementProof}`);
    }
    obligation.status = 'superseded';
    obligation.superseded_by = replacementProof;
    obligation.supersession_reason = reason;
    obligation.superseded_at = recordedAt;
    budget.state.proof_obligations.push({
      proof: replacementProof,
      status: 'required',
      metric: obligation.metric,
      required_at: recordedAt,
      relationship: 'trusted_governed_receipt_must_precede_obligation',
      receipt_type: requiredProofType,
      ...(requiredProofKind ? { kind: requiredProofKind } : {}),
      ...(requiredProofScope ? { scope: requiredProofScope } : {}),
      ...(requiredProofProfile ? { profile: requiredProofProfile } : {}),
      ...(requiredProofCommand ? { command: requiredProofCommand } : {})
    });
    await writeExecutionBudget(budget.budgetFile, budget.state);
    return {
      status: 'BUDGET_PROOF_SUPERSEDED',
      detail: { proof, replacement_proof: replacementProof }
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
  if (metric === 'correction_rechecks' && proposed > limit) {
    return {
      changed: false,
      status: 'BUDGET_CONSTRAINED',
      detail: {
        metric, scope, current, proposed, limit,
        reason: 'correction rechecks are a non-overridable one-per-seam lifecycle limit'
      }
    };
  }
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
    const matchingProofs = state.proof_obligations.filter((row) =>
      row.proof === requiredProof
    );
    const existingProof = matchingProofs.find((row) =>
      row.proof === requiredProof && row.status === 'required'
    );
    if (!existingProof && matchingProofs.length) {
      throw new Error(
        `proof identity already exists and is globally immutable: ${requiredProof}`
      );
    }
    if (existingProof) {
      const sameRelationship = existingProof.receipt_type === requiredProofType
        && (existingProof.kind || null) === requiredProofKind
        && (existingProof.scope || null) === requiredProofScope
        && (existingProof.profile || null) === requiredProofProfile
        && (existingProof.command || null) === requiredProofCommand;
      if (!sameRelationship) {
        throw new Error(`required proof identity has a conflicting receipt relationship: ${requiredProof}`);
      }
      existingProof.metrics = [...new Set([
        ...(existingProof.metrics || [existingProof.metric]),
        metric
      ])];
    } else {
      state.proof_obligations.push({
        proof: requiredProof,
        status: 'required',
        metric,
        required_at: recordedAt,
        relationship: 'trusted_governed_receipt_must_precede_obligation',
        receipt_type: requiredProofType,
        ...(requiredProofKind ? { kind: requiredProofKind } : {}),
        ...(requiredProofScope ? { scope: requiredProofScope } : {}),
        ...(requiredProofProfile ? { profile: requiredProofProfile } : {}),
        ...(requiredProofCommand ? { command: requiredProofCommand } : {})
      });
    }
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
