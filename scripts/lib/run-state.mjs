import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function sortedFiles(files) {
  if (!Array.isArray(files) || !files.every((file) => typeof file === 'string' && file)) {
    throw new Error('touchedFiles must be an array of paths');
  }
  return [...new Set(files)].sort();
}

export function startRunSlice(input, {
  id,
  summary,
  dirtyTreeFingerprint,
  touchedFiles = []
}) {
  if (input.current_slice) throw new Error('current slice is already in progress');
  const state = structuredClone(input);
  state.current_slice = {
    id: requiredText(id, 'slice id'),
    summary: requiredText(summary, 'slice summary'),
    started_dirty_tree_fingerprint: requiredText(
      dirtyTreeFingerprint,
      'dirtyTreeFingerprint'
    ),
    touched_files: sortedFiles(touchedFiles)
  };
  state.next_slice = null;
  return state;
}

export function checkpointRunState(input, {
  dirtyTreeFingerprint,
  touchedFiles,
  latestFailure = null,
  latestTest = null,
  nextAction,
  nextCommand = null
}) {
  if (!input.current_slice) throw new Error('checkpoint requires a current slice');
  const state = structuredClone(input);
  const files = sortedFiles(touchedFiles);
  state.current_slice.touched_files = files;
  state.recovery = {
    dirty_tree_fingerprint: requiredText(dirtyTreeFingerprint, 'dirtyTreeFingerprint'),
    touched_files: files,
    latest_failure: latestFailure === null ? null : requiredText(latestFailure, 'latestFailure'),
    latest_test: latestTest === null ? null : requiredText(latestTest, 'latestTest'),
    next_action: requiredText(nextAction, 'nextAction'),
    next_command: nextCommand === null ? null : requiredText(nextCommand, 'nextCommand')
  };
  return state;
}

export function reconcileRunState(state, { dirtyTreeFingerprint, touchedFiles }) {
  if (!state.recovery) throw new Error('resume reconciliation requires a checkpoint');
  const currentFiles = sortedFiles(touchedFiles);
  return {
    status: 'RESUME_RECONCILED',
    dirty_tree_changed: state.recovery.dirty_tree_fingerprint !== dirtyTreeFingerprint,
    checkpoint_dirty_tree_fingerprint: state.recovery.dirty_tree_fingerprint,
    current_dirty_tree_fingerprint: dirtyTreeFingerprint,
    touched_files: [...new Set([
      ...state.recovery.touched_files,
      ...currentFiles
    ])].sort(),
    latest_failure: state.recovery.latest_failure,
    latest_test: state.recovery.latest_test,
    next_action: state.recovery.next_action,
    next_command: state.recovery.next_command
  };
}

function list(items, empty = 'None recorded.') {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
    : empty;
}

export function projectRunMarkdown(state) {
  const current = state.current_slice;
  const next = state.next_slice;
  const recovery = state.recovery;
  return [
    '# Zimster Run',
    '',
    '> Canonical source: run.json. This file is a deterministic projection.',
    '',
    '## Mission and constraints',
    '',
    state.mission || 'See the approved plan and user request.',
    '',
    '## Profile and rationale',
    '',
    `- Profile: ${state.profile || 'Standard'}`,
    `- Rationale: ${state.rationale || 'Profile selected from the Zimster risk table.'}`,
    `- Durable-state triggers: ${state.durable_state_triggers?.join('; ') || 'none recorded'}`,
    '',
    '## Git disposition',
    '',
    `- Branch: ${state.branch || 'DETACHED'}`,
    `- Starting head: ${state.starting_head || 'UNBORN'}`,
    `- Commit policy: ${state.commit_policy || 'Follow repository policy.'}`,
    '',
    '## Harness capability receipt',
    '',
    '```json',
    JSON.stringify(state.capability_receipt || { schema_version: 1, harness: null, capabilities: null }, null, 2),
    '```',
    '',
    '## Architecture and current slice',
    '',
    `- Current slice: ${current ? `${current.id}: ${current.summary}` : 'none'}`,
    `- Next slice: ${next ? `${next.id}: ${next.summary}` : 'none'}`,
    '',
    '## Completed evidence',
    '',
    list(state.evidence),
    '',
    '## Open risks and findings',
    '',
    list(state.unresolved_risks),
    '',
    '## Recovery checkpoint',
    '',
    `- Dirty-tree fingerprint: ${recovery?.dirty_tree_fingerprint || 'none'}`,
    `- Touched files: ${recovery?.touched_files?.join(', ') || 'none'}`,
    `- Latest failure: ${recovery?.latest_failure || 'none'}`,
    `- Latest relevant test: ${recovery?.latest_test || 'none'}`,
    '',
    '## Next action',
    '',
    recovery?.next_action || (next ? next.summary : 'No next action recorded.'),
    '',
    '### Exact next command',
    '',
    recovery?.next_command ? `\`${recovery.next_command}\`` : 'Not known.',
    ''
  ].join('\n');
}

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
  profile = 'Standard',
  rationale = 'Profile selected from the Zimster risk table.',
  mission = null,
  capabilityReceipt = null,
  branch = null,
  commitPolicy = 'Follow repository policy.',
  durableStateTriggers = [],
  overwrite = false
} = {}) {
  const state = {
    schema_version: 2,
    id: randomUUID(),
    root_actor_id: rootActorId,
    started_at: new Date().toISOString(),
    starting_head: startingHead,
    profile,
    rationale,
    mission,
    capability_receipt: capabilityReceipt,
    branch,
    commit_policy: commitPolicy,
    durable_state_triggers: durableStateTriggers,
    plan: { id: planId, source: planSource },
    decisions: [],
    slice_commits: [],
    evidence: [],
    verifications: [],
    unresolved_risks: [],
    current_slice: null,
    next_slice: null,
    recovery: null
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
