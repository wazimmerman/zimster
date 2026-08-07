import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readRunState(runtime) {
  try {
    return JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
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
  overwrite = false
} = {}) {
  const state = {
    schema_version: 2,
    id: randomUUID(),
    root_actor_id: rootActorId,
    started_at: new Date().toISOString(),
    starting_head: startingHead,
    plan: { id: planId, source: planSource },
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
