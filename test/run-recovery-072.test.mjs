import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkpointRunState,
  projectRunMarkdown,
  reconcileRunState,
  startRunSlice
} from '../scripts/lib/run-state.mjs';

function state() {
  return {
    schema_version: 2,
    id: 'run-1',
    root_actor_id: 'root',
    started_at: '2026-08-18T00:00:00.000Z',
    starting_head: 'a'.repeat(40),
    profile: 'High risk',
    rationale: 'release recovery',
    plan: { id: 'plan-1', source: 'user-approved request' },
    decisions: [],
    slice_commits: [],
    evidence: [],
    verifications: [],
    unresolved_risks: [],
    current_slice: null,
    next_slice: { id: 'slice-1', summary: 'implement recovery' },
    recovery: null
  };
}

test('slice start records current work before implementation and keeps next slice distinct', () => {
  const started = startRunSlice(state(), {
    id: 'slice-1',
    summary: 'implement recovery',
    dirtyTreeFingerprint: 'clean',
    touchedFiles: []
  });
  assert.deepEqual(started.current_slice, {
    id: 'slice-1',
    summary: 'implement recovery',
    started_dirty_tree_fingerprint: 'clean',
    touched_files: []
  });
  assert.equal(started.next_slice, null);
});

test('dirty in-progress checkpoint preserves recovery facts and exact next command', () => {
  const started = startRunSlice(state(), {
    id: 'slice-1', summary: 'implement recovery',
    dirtyTreeFingerprint: 'clean', touchedFiles: []
  });
  const checkpointed = checkpointRunState(started, {
    dirtyTreeFingerprint: 'dirty-a',
    touchedFiles: ['scripts/lib/run-state.mjs', 'test/run-recovery-072.test.mjs'],
    latestFailure: 'focused test failed: expected CIRCUIT_BREAKER',
    latestTest: 'node --test test/run-recovery-072.test.mjs',
    nextAction: 'implement deterministic recovery state',
    nextCommand: 'node --test test/run-recovery-072.test.mjs'
  });
  assert.equal(checkpointed.recovery.dirty_tree_fingerprint, 'dirty-a');
  assert.deepEqual(checkpointed.recovery.touched_files, [
    'scripts/lib/run-state.mjs',
    'test/run-recovery-072.test.mjs'
  ]);
  assert.match(checkpointed.recovery.latest_failure, /CIRCUIT_BREAKER/);
  assert.equal(checkpointed.recovery.next_command, 'node --test test/run-recovery-072.test.mjs');
});

test('resume reconciliation is deterministic and reports dirty-tree drift without losing recovery data', () => {
  let checkpointed = startRunSlice(state(), {
    id: 'slice-1', summary: 'implement recovery',
    dirtyTreeFingerprint: 'clean', touchedFiles: []
  });
  checkpointed = checkpointRunState(checkpointed, {
    dirtyTreeFingerprint: 'dirty-a',
    touchedFiles: ['scripts/lib/run-state.mjs'],
    latestFailure: 'focused RED',
    latestTest: 'node --test test/run-recovery-072.test.mjs',
    nextAction: 'implement',
    nextCommand: 'node --test test/run-recovery-072.test.mjs'
  });
  const resumed = reconcileRunState(checkpointed, {
    dirtyTreeFingerprint: 'dirty-b',
    touchedFiles: ['scripts/lib/run-state.mjs', 'test/run-recovery-072.test.mjs']
  });
  assert.equal(resumed.status, 'RESUME_RECONCILED');
  assert.equal(resumed.dirty_tree_changed, true);
  assert.deepEqual(resumed.touched_files, [
    'scripts/lib/run-state.mjs',
    'test/run-recovery-072.test.mjs'
  ]);
  assert.equal(resumed.next_command, 'node --test test/run-recovery-072.test.mjs');
});

test('run.md is a deterministic human-readable projection of canonical state', () => {
  let canonical = startRunSlice(state(), {
    id: 'slice-1', summary: 'implement recovery',
    dirtyTreeFingerprint: 'clean', touchedFiles: []
  });
  canonical = checkpointRunState(canonical, {
    dirtyTreeFingerprint: 'dirty-a',
    touchedFiles: ['scripts/lib/run-state.mjs'],
    latestFailure: null,
    latestTest: 'node --test test/run-recovery-072.test.mjs',
    nextAction: 'run focused proof',
    nextCommand: 'node --test test/run-recovery-072.test.mjs'
  });
  const first = projectRunMarkdown(canonical);
  const second = projectRunMarkdown(structuredClone(canonical));
  assert.equal(first, second);
  assert.match(first, /Canonical source: run\.json/);
  assert.match(first, /Current slice[\s\S]*slice-1/);
  assert.match(first, /Exact next command[\s\S]*node --test/);
  assert.doesNotMatch(first, /generated_at|projection timestamp/i);
});
