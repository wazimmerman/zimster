import { readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { captureGitState, changedFiles } from './git-state.mjs';
import { evidenceStalenessReason } from './evidence-validity.mjs';
import {
  appendRunEvent,
  readRunState,
  withRunStateLock,
  writeRunState
} from './run-state.mjs';
import { refreshRunSummary } from './run-summary.mjs';

export const SLICE_STATUSES = Object.freeze([
  'not_started',
  'in_progress',
  'blocked',
  'awaiting_verification',
  'awaiting_review',
  'complete'
]);

const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function stringArray(value, name) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function guardArray(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((row) =>
    row && typeof row === 'object'
    && typeof row.id === 'string' && row.id
    && typeof row.statement === 'string' && row.statement
    && typeof row.status === 'string' && row.status
  )) throw new Error('guards must contain id, statement, and status');
  return value;
}

function evidenceArray(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((row) =>
    row && typeof row === 'object'
    && typeof row.id === 'string' && row.id
    && ['valid', 'stale', 'unavailable'].includes(row.status)
  )) throw new Error('evidence receipts require id and valid, stale, or unavailable status');
  return value;
}

function environment() {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version
  };
}

function evidenceEnvironment(hostVersion = null) {
  const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  return {
    ...environment(),
    npm: npm.status === 0 ? String(npm.stdout).trim() : null,
    host_version: hostVersion
  };
}

async function readJsonLinesOptional(file) {
  try {
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function revalidateEvidenceReferences(runtime, repo, references) {
  if (!Array.isArray(references) || references.length === 0) return [];
  const ledger = await readJsonLinesOptional(path.join(runtime, 'evidence', 'receipts.jsonl'));
  const git = await captureGitState(repo);
  return Promise.all(references.map(async (reference) => {
    if (reference.status === 'unavailable') return reference;
    const receipt = ledger.find((row) => row.id === reference.id && row.record_type !== 'invalidation');
    if (receipt) {
      const invalidation = ledger.findLast((row) =>
        row.record_type === 'invalidation' && row.receipt_id === reference.id
      );
      const reason = invalidation?.reason || await evidenceStalenessReason(receipt, {
        root: repo,
        state: git,
        environment: evidenceEnvironment(receipt.environment?.host_version ?? null)
      });
      return reason
        ? { id: reference.id, status: 'stale', invalidation_reason: reason }
        : { id: reference.id, status: 'valid' };
    }
    const verification = await readJsonOptional(path.join(
      runtime,
      'verification',
      'receipts',
      `${reference.id}.json`
    ));
    if (verification) {
      let reason = null;
      if (verification.status !== 'passed') reason = 'prior verification did not pass';
      if (!reason && verification.git_commit !== git.head) reason = 'immutable Git commit changed';
      if (!reason && verification.git_tree !== git.tree) reason = 'immutable Git tree changed';
      if (
        !reason
        && verification.dirty_tree_fingerprint !== git.dirty_tree_fingerprint
      ) reason = 'dirty tree changed';
      if (
        !reason
        && JSON.stringify(verification.environment || {}) !== JSON.stringify(environment())
      ) reason = 'environment fingerprint changed';
      return reason
        ? { id: reference.id, status: 'stale', invalidation_reason: reason }
        : { id: reference.id, status: 'valid' };
    }
    return {
      id: reference.id,
      status: 'unavailable',
      unavailable_reason: 'referenced receipt was not found in a trusted Zimster ledger'
    };
  }));
}

function verificationReference(receipt) {
  if (!receipt) return null;
  return {
    receipt_id: receipt.id,
    profile: receipt.profile,
    status: receipt.status,
    failed_step: receipt.failed_step,
    action: receipt.action,
    git_commit: receipt.git_commit,
    git_tree: receipt.git_tree,
    dirty_tree_fingerprint: receipt.dirty_tree_fingerprint
  };
}

function failureReference(receipt) {
  if (!receipt || receipt.status !== 'failed') return null;
  const step = receipt.steps?.find(({ id }) => id === receipt.failed_step) || null;
  return {
    receipt_id: receipt.id,
    step_id: receipt.failed_step,
    command_argv: step?.command_argv || null,
    exit_code: step?.exit_code ?? 1,
    summary: receipt.action || step?.reason || 'verification failed'
  };
}

async function currentReviewPosition(runtime) {
  const lifecycle = await readJsonOptional(path.join(runtime, 'review-lifecycle', 'whole-release.json'));
  if (!lifecycle) return { status: 'not_initialized', attempts: 0 };
  return {
    status: lifecycle.status,
    attempts: Array.isArray(lifecycle.attempts) ? lifecycle.attempts.length : 0,
    circuit_breaker_active: lifecycle.circuit_breaker_active === true,
    strategy_escalation: lifecycle.strategy_escalation || null
  };
}

async function currentBudgetPosition(runtime) {
  const budget = await readJsonOptional(path.join(runtime, 'budget.json'));
  if (!budget) return { status: 'unavailable' };
  return {
    status: budget.accounting_status || 'recorded',
    limits: budget.limits || {},
    usage: budget.usage || {}
  };
}

export async function migrateRunAndCheckpoint(runtime, repo) {
  let state = await readRunState(runtime);
  if (!state) throw new Error('run.json is required');
  if (state.schema_version === 3) return { state, migrated: false, recoveryRequired: false };
  if (!Number.isInteger(state.schema_version) || state.schema_version > 3) {
    throw new Error(`unsupported run.json schema_version ${state.schema_version}`);
  }
  const checkpointFile = path.join(runtime, 'checkpoints', 'current.json');
  const legacyCheckpoint = await readJsonOptional(checkpointFile);
  const git = await captureGitState(repo);
  const touched = changedFiles(repo);
  const legacyNext = legacyCheckpoint?.exact_next_slice || null;
  const ambiguous = !state.current_slice && touched.length > 0 && Boolean(legacyNext);
  state = {
    ...state,
    schema_version: 3,
    state_revision: Number.isInteger(state.state_revision) ? state.state_revision : 0,
    profile: state.profile || null,
    profile_rationale: state.profile_rationale || null,
    durable_state_triggers: state.durable_state_triggers || [],
    branch: state.branch || git.branch,
    capability_receipt: state.capability_receipt || null,
    current_slice: state.current_slice || null,
    next_slice: state.next_slice || (legacyNext ? { id: legacyNext, title: legacyNext } : null),
    exact_next_action: state.exact_next_action || legacyCheckpoint?.exact_next_action || null,
    exact_next_command: state.exact_next_command || legacyCheckpoint?.exact_next_command || null,
    completed_slices: state.completed_slices || [],
    guard_assertions: state.guard_assertions || legacyCheckpoint?.guard_assertions || [],
    architecture: state.architecture || legacyCheckpoint?.current_architecture || [],
    migration: {
      from_schema_version: state.schema_version,
      status: ambiguous ? 'recovery_reconciliation_required' : 'migrated'
    }
  };
  await writeRunState(runtime, state);
  if (legacyCheckpoint) {
    const migratedCheckpoint = {
      ...legacyCheckpoint,
      schema_version: 2,
      run_id: state.id,
      run_state_revision: state.state_revision,
      current_slice: state.current_slice,
      next_slice: state.next_slice,
      repository_state: {
        head: git.head,
        tree: git.tree,
        dirty_tree_fingerprint: git.dirty_tree_fingerprint,
        touched_files: touched
      },
      completed_obligations: legacyCheckpoint.completed_obligations || [],
      remaining_obligations: legacyCheckpoint.remaining_obligations || [],
      latest_meaningful_verification: legacyCheckpoint.latest_meaningful_verification || null,
      active_failure: legacyCheckpoint.active_failure || null,
      corrections_completed: legacyCheckpoint.corrections_completed || [],
      guards: legacyCheckpoint.guards || legacyCheckpoint.guard_assertions || [],
      exact_next_action: state.exact_next_action,
      exact_next_command: state.exact_next_command,
      recovery_status: ambiguous
        ? 'RECOVERY_RECONCILIATION_REQUIRED'
        : 'MIGRATED'
    };
    await writeJsonAtomic(checkpointFile, migratedCheckpoint);
  }
  await appendRunEvent(runtime, {
    event_type: 'run_state_migrated',
    from_schema_version: state.migration.from_schema_version,
    to_schema_version: 3,
    recovery_status: state.migration.status
  });
  await refreshRunSummary(runtime, { repo });
  return { state, migrated: true, recoveryRequired: ambiguous };
}

function clearTransientRecoveryDiagnostics(checkpoint) {
  delete checkpoint.active_transaction;
  delete checkpoint.reconciliation_reason;
}

export async function recoveryCheckpoint(runtime, repo, state, changes = {}) {
  const prior = await readJsonOptional(path.join(runtime, 'checkpoints', 'current.json')) || {};
  const git = await captureGitState(repo);
  const checkpoint = {
    ...prior,
    schema_version: 2,
    run_id: state.id,
    run_state_revision: state.state_revision,
    current_slice: state.current_slice
      ? { id: state.current_slice.id, title: state.current_slice.title, status: state.current_slice.status }
      : null,
    next_slice: state.next_slice,
    slice_base: state.current_slice ? {
      head: state.current_slice.base_head,
      tree: state.current_slice.base_tree
    } : null,
    repository_state: {
      head: git.head,
      tree: git.tree,
      dirty_tree_fingerprint: git.dirty_tree_fingerprint,
      touched_files: changedFiles(repo)
    },
    completed_obligations: changes.completedObligations
      ?? state.current_slice?.completed_obligations
      ?? prior.completed_obligations
      ?? [],
    remaining_obligations: changes.remainingObligations
      ?? state.current_slice?.remaining_obligations
      ?? prior.remaining_obligations
      ?? [],
    blocking_obligations: changes.blockingObligations
      ?? prior.blocking_obligations
      ?? [],
    latest_meaningful_verification: changes.latestVerification
      ?? prior.latest_meaningful_verification
      ?? null,
    active_failure: Object.hasOwn(changes, 'activeFailure')
      ? changes.activeFailure
      : prior.active_failure ?? null,
    corrections_completed: changes.corrections
      ?? prior.corrections_completed
      ?? [],
    open_findings: changes.findings
      ?? prior.open_findings
      ?? [],
    evidence_receipts: changes.evidenceReceipts
      ?? prior.evidence_receipts
      ?? [],
    review_position: await currentReviewPosition(runtime),
    budget_position: await currentBudgetPosition(runtime),
    unavailable_evidence: changes.unavailableEvidence
      ?? prior.unavailable_evidence
      ?? [],
    guards: changes.guards
      ?? state.guard_assertions
      ?? prior.guards
      ?? [],
    exact_next_action: state.exact_next_action,
    exact_next_command: state.exact_next_command,
    environment: environment(),
    recovery_status: changes.recoveryStatus || 'CHECKPOINT_CURRENT'
  };
  clearTransientRecoveryDiagnostics(checkpoint);
  const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 32 * 1024) {
    throw new Error('recovery checkpoint exceeds compact 32768-byte limit');
  }
  await writeJsonAtomic(path.join(runtime, 'checkpoints', 'current.json'), checkpoint);
  return checkpoint;
}

export async function startSlice(runtime, repo, input) {
  return withRunStateLock(runtime, async () => {
    const migration = await migrateRunAndCheckpoint(runtime, repo);
    const state = migration.state;
    if (migration.recoveryRequired) throw new Error('RECOVERY_RECONCILIATION_REQUIRED');
    if (state.current_slice) throw new Error(`slice ${state.current_slice.id} is already current`);
    const git = await captureGitState(repo);
    if (git.dirty_tree_fingerprint !== CLEAN_FINGERPRINT) {
      throw new Error('slice start requires a clean attributed base; reconcile existing dirty work first');
    }
    const sliceId = nonEmpty(input.sliceId, '--slice-id');
    const sliceTitle = input.sliceTitle || sliceId;
    const remaining = stringArray(input.remainingObligations, '--remaining-obligations') || [];
    state.state_revision += 1;
    state.current_slice = {
      id: sliceId,
      title: sliceTitle,
      status: 'in_progress',
      base_head: git.head,
      base_tree: git.tree,
      base_dirty_tree_fingerprint: git.dirty_tree_fingerprint,
      started_at: new Date().toISOString(),
      completed_obligations: [],
      remaining_obligations: remaining
    };
    state.next_slice = input.nextSliceId
      ? { id: input.nextSliceId, title: input.nextSliceTitle || input.nextSliceId }
      : (state.next_slice?.id === sliceId ? null : state.next_slice);
    state.exact_next_action = input.nextAction || state.exact_next_action;
    state.exact_next_command = input.nextCommand || state.exact_next_command;
    await writeRunState(runtime, state);
    await appendRunEvent(runtime, {
      event_type: 'slice_started',
      slice_id: sliceId,
      status: 'in_progress',
      base_head: git.head,
      base_tree: git.tree,
      run_state_revision: state.state_revision
    });
    const checkpoint = await recoveryCheckpoint(runtime, repo, state, {
      remainingObligations: remaining,
      recoveryStatus: 'SLICE_STARTED'
    });
    await refreshRunSummary(runtime, { repo });
    return { state, checkpoint };
  });
}

export async function checkpointRun(runtime, repo, input = {}) {
  return withRunStateLock(runtime, async () => {
    const migration = await migrateRunAndCheckpoint(runtime, repo);
    const state = migration.state;
    if (migration.recoveryRequired) throw new Error('RECOVERY_RECONCILIATION_REQUIRED');
    if (!state.current_slice) throw new Error('no current slice to checkpoint');
    if (input.status) {
      if (!SLICE_STATUSES.includes(input.status) || input.status === 'complete') {
        throw new Error('--status must be in_progress, blocked, awaiting_verification, or awaiting_review');
      }
      state.current_slice.status = input.status;
    }
    const completed = stringArray(input.completedObligations, '--completed-obligations');
    const remaining = stringArray(input.remainingObligations, '--remaining-obligations');
    const blocking = stringArray(input.blockingObligations, '--blocking-obligations');
    const corrections = stringArray(input.corrections, '--corrections');
    const findings = stringArray(input.findings, '--findings');
    const unavailableEvidence = stringArray(input.unavailableEvidence, '--unavailable-evidence');
    const guards = guardArray(input.guards);
    const evidenceReceipts = evidenceArray(input.evidenceReceipts);
    if (completed) state.current_slice.completed_obligations = completed;
    if (remaining) state.current_slice.remaining_obligations = remaining;
    if (guards) state.guard_assertions = guards;
    if (input.nextAction) state.exact_next_action = input.nextAction;
    if (input.nextCommand) state.exact_next_command = input.nextCommand;
    state.state_revision += 1;
    await writeRunState(runtime, state);
    const checkpoint = await recoveryCheckpoint(runtime, repo, state, {
      completedObligations: completed,
      remainingObligations: remaining,
      blockingObligations: blocking,
      corrections,
      findings,
      unavailableEvidence,
      guards,
      evidenceReceipts,
      recoveryStatus: 'CHECKPOINT_CURRENT'
    });
    await appendRunEvent(runtime, {
      event_type: 'checkpoint_created',
      slice_id: state.current_slice.id,
      status: state.current_slice.status,
      run_state_revision: state.state_revision,
      dirty_tree_fingerprint: checkpoint.repository_state.dirty_tree_fingerprint,
      touched_files: checkpoint.repository_state.touched_files
    });
    await refreshRunSummary(runtime, { repo });
    return checkpoint;
  });
}

export async function recordVerificationInRecovery(runtime, repo, receipt) {
  const state = await readRunState(runtime);
  if (!state?.current_slice) return null;
  return withRunStateLock(runtime, async () => {
    const current = await readRunState(runtime);
    if (!current?.current_slice) return null;
    current.state_revision += 1;
    if (receipt.status === 'failed') {
      current.current_slice.status = 'blocked';
      current.exact_next_action = receipt.action || `Correct failed verification ${receipt.failed_step}`;
      const failed = receipt.steps?.find(({ id }) => id === receipt.failed_step);
      current.exact_next_command = failed?.command_argv?.join(' ') || current.exact_next_command;
    } else if (current.current_slice.status === 'blocked') {
      current.current_slice.status = 'awaiting_verification';
    }
    await writeRunState(runtime, current);
    const checkpoint = await recoveryCheckpoint(runtime, repo, current, {
      latestVerification: verificationReference(receipt),
      activeFailure: failureReference(receipt),
      recoveryStatus: receipt.status === 'failed' ? 'VERIFICATION_FAILED' : 'VERIFICATION_PASSED'
    });
    await appendRunEvent(runtime, {
      event_type: 'verification_recorded',
      receipt_id: receipt.id,
      status: receipt.status,
      slice_id: current.current_slice.id,
      run_state_revision: current.state_revision
    });
    await refreshRunSummary(runtime, { repo });
    return checkpoint;
  });
}

export async function resumeRun(runtime, repo) {
  return withRunStateLock(runtime, async () => {
    const migration = await migrateRunAndCheckpoint(runtime, repo);
    let state = migration.state;
    let checkpoint = await readJsonOptional(path.join(runtime, 'checkpoints', 'current.json'));
    const transactionFile = path.join(runtime, 'transactions', 'current.json');
    const transaction = await readJsonOptional(transactionFile);
    if (!checkpoint) {
      checkpoint = await recoveryCheckpoint(runtime, repo, state, {
        recoveryStatus: state.current_slice ? 'CHECKPOINT_RECONSTRUCTED' : 'NO_CURRENT_SLICE'
      });
    }
    if (migration.recoveryRequired) {
      await refreshRunSummary(runtime, { repo });
      return { checkpoint, recoveryRequired: true };
    }
    if (transaction) {
      if (transaction.schema_version !== 1
        || typeof transaction.transaction_id !== 'string'
        || typeof transaction.mutation_type !== 'string'
        || !['started', 'canonical_mutation_applied'].includes(transaction.phase)) {
        throw new Error('control-plane transaction marker is malformed');
      }
      if (transaction.phase === 'started') {
        checkpoint = await recoveryCheckpoint(runtime, repo, state, {
          recoveryStatus: 'RECOVERY_RECONCILIATION_REQUIRED'
        });
        checkpoint.reconciliation_reason = `control-plane mutation ${transaction.mutation_type} was interrupted before canonical success was durable`;
        checkpoint.active_transaction = transaction;
        await writeJsonAtomic(path.join(runtime, 'checkpoints', 'current.json'), checkpoint);
        await appendRunEvent(runtime, {
          event_type: 'control_plane_mutation_reconciliation_required',
          transaction_id: transaction.transaction_id,
          mutation_type: transaction.mutation_type,
          run_state_revision: state.state_revision
        });
        await refreshRunSummary(runtime, { repo });
        return { checkpoint, recoveryRequired: true };
      }
      const beforeRevision = transaction.run_state_revision_before;
      if (state.state_revision === beforeRevision) {
        state.state_revision += 1;
        await writeRunState(runtime, state);
      } else if (state.state_revision !== beforeRevision + 1) {
        checkpoint = await recoveryCheckpoint(runtime, repo, state, {
          recoveryStatus: 'RECOVERY_RECONCILIATION_REQUIRED'
        });
        checkpoint.reconciliation_reason = 'control-plane transaction revision cannot be reconciled deterministically';
        checkpoint.active_transaction = transaction;
        await writeJsonAtomic(path.join(runtime, 'checkpoints', 'current.json'), checkpoint);
        await refreshRunSummary(runtime, { repo });
        return { checkpoint, recoveryRequired: true };
      }
      checkpoint = await recoveryCheckpoint(runtime, repo, state, {
        recoveryStatus: 'RECONCILED_CONTROL_PLANE_MUTATION'
      });
      await appendRunEvent(runtime, {
        event_type: 'control_plane_mutation_reconciled',
        transaction_id: transaction.transaction_id,
        mutation_type: transaction.mutation_type,
        run_state_revision: state.state_revision
      });
      await rm(transactionFile, { force: true });
    }
    clearTransientRecoveryDiagnostics(checkpoint);
    if (checkpoint.run_state_revision !== state.state_revision) {
      const priorRevision = checkpoint.run_state_revision ?? null;
      checkpoint = await recoveryCheckpoint(runtime, repo, state, {
        recoveryStatus: 'RECONCILED_PARTIAL_MUTATION'
      });
      await appendRunEvent(runtime, {
        event_type: 'partial_mutation_reconciled',
        prior_run_state_revision: priorRevision,
        current_run_state_revision: state.state_revision
      });
    }
    const git = await captureGitState(repo);
    const touched = changedFiles(repo);
    if (state.current_slice) {
      if (checkpoint.current_slice?.id && checkpoint.current_slice.id !== state.current_slice.id) {
        checkpoint.recovery_status = 'RECOVERY_RECONCILIATION_REQUIRED';
        checkpoint.reconciliation_reason = 'checkpoint current slice disagrees with run.json';
      } else if (git.head !== checkpoint.repository_state?.head) {
        checkpoint.recovery_status = 'RECOVERY_RECONCILIATION_REQUIRED';
        checkpoint.reconciliation_reason = 'HEAD changed after the last durable snapshot';
      } else if (
        git.dirty_tree_fingerprint !== checkpoint.repository_state?.dirty_tree_fingerprint
        || JSON.stringify(touched) !== JSON.stringify(checkpoint.repository_state?.touched_files || [])
      ) {
        checkpoint.repository_state = {
          head: git.head,
          tree: git.tree,
          dirty_tree_fingerprint: git.dirty_tree_fingerprint,
          touched_files: touched
        };
        checkpoint.recovery_status = 'RECONCILED_WORKTREE_CHANGE';
        await appendRunEvent(runtime, {
          event_type: 'recovery_reconciled',
          slice_id: state.current_slice.id,
          reason: 'worktree changed after the last durable snapshot',
          dirty_tree_fingerprint: git.dirty_tree_fingerprint,
          touched_files: touched
        });
      }
    } else if (touched.length && checkpoint.current_slice === null) {
      checkpoint.recovery_status = 'RECOVERY_RECONCILIATION_REQUIRED';
      checkpoint.reconciliation_reason = 'dirty work exists without a durably started current slice';
    }
    checkpoint.run_state_revision = state.state_revision;
    checkpoint.current_slice = state.current_slice
      ? { id: state.current_slice.id, title: state.current_slice.title, status: state.current_slice.status }
      : null;
    checkpoint.next_slice = state.next_slice;
    checkpoint.exact_next_action = state.exact_next_action;
    checkpoint.exact_next_command = state.exact_next_command;
    checkpoint.evidence_receipts = await revalidateEvidenceReferences(
      runtime,
      repo,
      checkpoint.evidence_receipts
    );
    await writeJsonAtomic(path.join(runtime, 'checkpoints', 'current.json'), checkpoint);
    await appendRunEvent(runtime, { event_type: 'run_resumed', actor_id: 'root' });
    await refreshRunSummary(runtime, { repo });
    return {
      checkpoint,
      recoveryRequired: checkpoint.recovery_status === 'RECOVERY_RECONCILIATION_REQUIRED'
    };
  });
}

export async function reconcileStartedTransaction(runtime, repo, {
  transactionId,
  disposition,
  reason,
  evidence
}) {
  transactionId = nonEmpty(transactionId, 'transaction id');
  reason = nonEmpty(reason, 'reconciliation reason');
  const reconciliationEvidence = stringArray(evidence, 'reconciliation evidence');
  if (disposition !== 'no_canonical_mutation') {
    throw new Error('only no_canonical_mutation is supported for a pre-write transaction');
  }
  if (!reconciliationEvidence?.length) {
    throw new Error('reconciliation evidence must contain at least one durable observation');
  }
  return withRunStateLock(runtime, async () => {
    const transactionFile = path.join(runtime, 'transactions', 'current.json');
    const transaction = await readJsonOptional(transactionFile);
    if (!transaction || transaction.transaction_id !== transactionId) {
      throw new Error(`active transaction does not match: ${transactionId}`);
    }
    if (transaction.schema_version !== 1 || transaction.phase !== 'started') {
      throw new Error('no-op reconciliation requires a schema-1 started transaction');
    }
    const state = await readRunState(runtime);
    if (state.state_revision !== transaction.run_state_revision_before) {
      throw new Error('no-op reconciliation rejected because canonical run revision advanced');
    }
    const git = await captureGitState(repo);
    const candidateAtReconciliation = {
      head: git.head,
      tree: git.tree,
      dirty_tree_fingerprint: git.dirty_tree_fingerprint
    };
    const candidateChanged = JSON.stringify(candidateAtReconciliation)
      !== JSON.stringify(transaction.candidate_before || null);
    const reconciledAt = new Date().toISOString();
    const archived = {
      ...transaction,
      phase: 'reconciled_no_canonical_mutation',
      reconciled_at: reconciledAt,
      reconciliation_reason: reason,
      reconciliation_evidence: reconciliationEvidence,
      candidate_changed_during_reconciliation: candidateChanged,
      candidate_at_reconciliation: candidateAtReconciliation
    };
    const archiveFile = path.join(
      runtime,
      'transactions',
      'reconciled',
      `${transaction.transaction_id}.json`
    );
    await writeJsonAtomic(archiveFile, archived);
    state.state_revision += 1;
    await writeRunState(runtime, state);
    await recoveryCheckpoint(runtime, repo, state, {
      recoveryStatus: 'RECONCILED_CONTROL_PLANE_MUTATION'
    });
    await appendRunEvent(runtime, {
      event_type: 'control_plane_mutation_reconciled_noop',
      transaction_id: transaction.transaction_id,
      mutation_type: transaction.mutation_type,
      disposition,
      reason,
      evidence: reconciliationEvidence,
      run_state_revision: state.state_revision
    });
    await refreshRunSummary(runtime, { repo });
    await rm(transactionFile, { force: true });
    return { transaction: archived, archiveFile };
  });
}

export async function completeSlice(runtime, repo, { verificationReceiptId, nextAction, nextCommand } = {}) {
  return withRunStateLock(runtime, async () => {
    const migration = await migrateRunAndCheckpoint(runtime, repo);
    const state = migration.state;
    if (migration.recoveryRequired) throw new Error('RECOVERY_RECONCILIATION_REQUIRED');
    if (!state.current_slice) throw new Error('no current slice to complete');
    if (!verificationReceiptId) throw new Error('a current passing verification receipt is required');
    const receipt = await readJsonOptional(path.join(
      runtime,
      'verification',
      'receipts',
      `${verificationReceiptId}.json`
    ));
    if (!receipt || receipt.status !== 'passed') {
      throw new Error('a current passing verification receipt is required');
    }
    const git = await captureGitState(repo);
    if (
      git.dirty_tree_fingerprint !== CLEAN_FINGERPRINT
      || receipt.git_commit !== git.head
      || receipt.git_tree !== git.tree
      || receipt.dirty_tree_fingerprint !== git.dirty_tree_fingerprint
      || JSON.stringify(receipt.environment || {}) !== JSON.stringify(environment())
    ) throw new Error('passing verification is stale or the slice remains dirty');
    const completed = {
      ...state.current_slice,
      status: 'complete',
      completed_head: git.head,
      completed_tree: git.tree,
      verification_receipt_id: receipt.id,
      completed_at: new Date().toISOString()
    };
    state.completed_slices ||= [];
    state.completed_slices.push(completed);
    state.current_slice = null;
    state.exact_next_action = nextAction || state.exact_next_action;
    state.exact_next_command = nextCommand || state.exact_next_command;
    state.state_revision += 1;
    await writeRunState(runtime, state);
    const checkpoint = await recoveryCheckpoint(runtime, repo, state, {
      latestVerification: verificationReference(receipt),
      activeFailure: null,
      completedObligations: [
        ...(completed.completed_obligations || []),
        ...(completed.remaining_obligations || [])
      ],
      remainingObligations: [],
      recoveryStatus: 'SLICE_COMPLETED'
    });
    await appendRunEvent(runtime, {
      event_type: 'slice_completed',
      slice_id: completed.id,
      head: git.head,
      tree: git.tree,
      verification_receipt_id: receipt.id,
      run_state_revision: state.state_revision
    });
    await refreshRunSummary(runtime, { repo });
    return { state, checkpoint };
  });
}
