import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readRunState(runtime) {
  try {
    return JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeRunState(runtime, state) {
  const file = path.join(runtime, 'run.json');
  const temporary = `${file}.temporary-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return state;
}

export function applyRecoveryInstruction(state, instruction) {
  if (instruction === null || instruction === undefined) return state;
  if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) {
    throw new Error('recovery instruction must be an object');
  }
  const allowed = new Set(['exact_next_action', 'exact_next_command']);
  const fields = Object.keys(instruction);
  if (!fields.length || fields.some((field) => !allowed.has(field))) {
    throw new Error('recovery instruction contains unsupported fields');
  }
  for (const field of fields) {
    const value = instruction[field];
    if (value !== null && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`recovery instruction ${field} must be text or null`);
    }
    state[field] = value;
  }
  return state;
}

export async function withRunStateLock(runtime, operation) {
  const lock = path.join(runtime, 'state.lock');
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
  if (!acquired) throw new Error('durable run state is busy; retry the operation');
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function appendRunEvent(runtime, event) {
  const state = await readRunState(runtime);
  if (!state) return null;
  const directory = path.join(runtime, 'events');
  await mkdir(directory, { recursive: true });
  const row = {
    schema_version: 1,
    run_id: state.id,
    recorded_at: new Date().toISOString(),
    ...event
  };
  await appendFile(path.join(directory, 'events.jsonl'), `${JSON.stringify(row)}\n`);
  return row;
}

export async function initializeRunState(runtime, {
  rootActorId = 'root',
  startingHead = null,
  planId = 'unregistered-plan',
  planSource = 'user-approved request',
  profile = 'standard',
  profileRationale = 'Profile selected from the Zimster risk table.',
  durableStateTriggers = [],
  branch = null,
  capabilityReceipt = null,
  nextSlice = null,
  exactNextAction = null,
  exactNextCommand = null,
  overwrite = false
} = {}) {
  const state = {
    schema_version: 3,
    id: randomUUID(),
    root_actor_id: rootActorId,
    started_at: new Date().toISOString(),
    starting_head: startingHead,
    plan: { id: planId, source: planSource },
    profile,
    profile_rationale: profileRationale,
    durable_state_triggers: durableStateTriggers,
    branch,
    capability_receipt: capabilityReceipt,
    state_revision: 0,
    current_slice: null,
    next_slice: nextSlice,
    exact_next_action: exactNextAction,
    exact_next_command: exactNextCommand,
    completed_slices: [],
    guard_assertions: [],
    architecture: [
      'run.json owns workflow position',
      'receipts and append-only ledgers own observed activity',
      'budget.json owns policy and reconciled projections',
      'checkpoints/current.json is a revision-bound recovery snapshot',
      'run.md is deterministic derived output'
    ],
    decisions: [],
    slice_commits: [],
    evidence: [],
    verifications: [],
    unresolved_risks: []
  };
  await mkdir(runtime, { recursive: true });
  await writeFile(
    path.join(runtime, 'run.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    { flag: overwrite ? 'w' : 'wx' }
  );
  await appendRunEvent(runtime, {
    event_type: 'run_started',
    actor_id: rootActorId
  });
  return state;
}
