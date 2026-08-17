import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureGitState } from './git-state.mjs';
import { recoveryCheckpoint } from './run-control.mjs';
import {
  applyRecoveryInstruction,
  appendRunEvent,
  readRunState,
  withRunStateLock,
  writeRunState
} from './run-state.mjs';
import { checkRunSummary, refreshRunSummary } from './run-summary.mjs';

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

async function validateSynchronizedState(runtime, repo, state, checkpoint) {
  if (state.current_slice?.id && state.current_slice.id === state.next_slice?.id) {
    throw new Error('control-plane invariant failed: current and next slice must differ');
  }
  if (checkpoint.run_id !== state.id || checkpoint.run_state_revision !== state.state_revision) {
    throw new Error('control-plane invariant failed: checkpoint revision does not match run state');
  }
  if (checkpoint.current_slice?.id !== state.current_slice?.id) {
    throw new Error('control-plane invariant failed: checkpoint current slice does not match run state');
  }
  const git = await captureGitState(repo);
  if (checkpoint.repository_state?.head !== git.head
    || checkpoint.repository_state?.tree !== git.tree
    || checkpoint.repository_state?.dirty_tree_fingerprint !== git.dirty_tree_fingerprint) {
    throw new Error('control-plane invariant failed: checkpoint does not match repository state');
  }
  if (!(await checkRunSummary(runtime, { repo })).current) {
    throw new Error('control-plane invariant failed: run.md is stale after mutation');
  }
}

function normalizeRecoveryInstruction(instruction) {
  if (instruction === null) return null;
  if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) {
    throw new Error('control-plane recovery instruction must resolve to an object');
  }
  const normalized = {};
  for (const [field, stateField] of [
    ['nextAction', 'exact_next_action'],
    ['nextCommand', 'exact_next_command']
  ]) {
    if (Object.hasOwn(instruction, field)) normalized[stateField] = instruction[field];
  }
  applyRecoveryInstruction({}, normalized);
  return normalized;
}

export async function readControlPlaneTransaction(runtime) {
  try {
    return JSON.parse(await readFile(path.join(runtime, 'transactions', 'current.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function evidenceCheckpointChanges(runtime, reference) {
  if (!reference || typeof reference.id !== 'string'
    || !['valid', 'stale', 'unavailable'].includes(reference.status)) {
    throw new Error('checkpoint evidence mutation requires id and valid, stale, or unavailable status');
  }
  let checkpoint = null;
  try {
    checkpoint = JSON.parse(await readFile(
      path.join(runtime, 'checkpoints', 'current.json'),
      'utf8'
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const current = checkpoint?.evidence_receipts || [];
  return {
    evidenceReceipts: [
      ...current.filter(({ id }) => id !== reference.id),
      structuredClone(reference)
    ]
  };
}

export async function withControlPlaneMutation(runtime, repo, {
  mutationType,
  actorId = 'root',
  checkpointChanges = null,
  recoveryInstruction = null,
  didMutate = () => true,
  atomicFailure = false,
  preflight = null
}, operation) {
  if (typeof mutationType !== 'string' || !mutationType.trim()) {
    throw new Error('control-plane mutation type is required');
  }
  if (typeof operation !== 'function') throw new Error('control-plane mutation operation is required');
  if (preflight !== null && typeof preflight !== 'function') {
    throw new Error('control-plane mutation preflight must be a function');
  }
  if (recoveryInstruction !== null
    && typeof recoveryInstruction !== 'function'
    && (typeof recoveryInstruction !== 'object' || Array.isArray(recoveryInstruction))) {
    throw new Error('control-plane recovery instruction must be an object or function');
  }
  const initial = await readRunState(runtime);
  if (!initial || initial.schema_version !== 3) return operation();

  return withRunStateLock(runtime, async () => {
    const before = await readRunState(runtime);
    if (!before || before.schema_version !== 3) return operation();
    const transactionId = randomUUID();
    const markerFile = path.join(runtime, 'transactions', 'current.json');
    if (await readControlPlaneTransaction(runtime)) {
      throw new Error('a prior control-plane mutation requires resume or reconciliation');
    }
    if (preflight) await preflight({ state: before });
    const candidate = await captureGitState(repo);
    const marker = {
      schema_version: 1,
      transaction_id: transactionId,
      mutation_type: mutationType,
      actor_id: actorId,
      phase: 'started',
      run_state_revision_before: before.state_revision,
      candidate_before: {
        head: candidate.head,
        tree: candidate.tree,
        dirty_tree_fingerprint: candidate.dirty_tree_fingerprint
      },
      started_at: new Date().toISOString()
    };
    await writeJsonAtomic(markerFile, marker);
    await appendRunEvent(runtime, {
      event_type: 'control_plane_mutation_started',
      transaction_id: transactionId,
      mutation_type: mutationType,
      actor_id: actorId,
      run_state_revision: before.state_revision
    });

    let result;
    try {
      result = await operation();
    } catch (error) {
      await appendRunEvent(runtime, {
        event_type: 'control_plane_mutation_failed',
        transaction_id: transactionId,
        mutation_type: mutationType,
        actor_id: actorId,
        failure_atomic: atomicFailure,
        error: error.message,
        run_state_revision: before.state_revision
      });
      if (atomicFailure) await rm(markerFile, { force: true });
      throw error;
    }
    if (!didMutate(result)) {
      await appendRunEvent(runtime, {
        event_type: 'control_plane_mutation_noop',
        transaction_id: transactionId,
        mutation_type: mutationType,
        actor_id: actorId,
        run_state_revision: before.state_revision
      });
      await rm(markerFile, { force: true });
      return result;
    }
    const instruction = normalizeRecoveryInstruction(
      typeof recoveryInstruction === 'function'
        ? await recoveryInstruction(result)
        : recoveryInstruction
    );
    await writeJsonAtomic(markerFile, {
      ...marker,
      phase: 'canonical_mutation_applied',
      canonical_mutation_applied_at: new Date().toISOString(),
      ...(instruction ? { recovery_instruction: instruction } : {})
    });
    const state = await readRunState(runtime);
    if (state.state_revision !== before.state_revision) {
      throw new Error('control-plane mutation unexpectedly changed run state outside its coordinator');
    }
    applyRecoveryInstruction(state, instruction);
    state.state_revision += 1;
    await writeRunState(runtime, state);
    const changes = typeof checkpointChanges === 'function'
      ? await checkpointChanges(result)
      : checkpointChanges || {};
    const checkpoint = await recoveryCheckpoint(runtime, repo, state, {
      ...changes,
      recoveryStatus: changes.recoveryStatus || 'CONTROL_PLANE_MUTATION_CURRENT'
    });
    await appendRunEvent(runtime, {
      event_type: 'control_plane_mutation_completed',
      transaction_id: transactionId,
      mutation_type: mutationType,
      actor_id: actorId,
      run_state_revision: state.state_revision
    });
    await refreshRunSummary(runtime, { repo });
    await validateSynchronizedState(runtime, repo, state, checkpoint);
    await rm(markerFile, { force: true });
    return result;
  });
}
