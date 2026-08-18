import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkpointRunState,
  persistRunStateAndProjections,
  projectRunMarkdown,
  reconcileRunProjections,
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

test('restart reconciles checkpoint and run.md from canonical run.json after interruption', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-run-persist-'));
  try {
    let canonical = startRunSlice(state(), {
      id: 'slice-1', summary: 'implement recovery',
      dirtyTreeFingerprint: 'clean', touchedFiles: []
    });
    canonical = checkpointRunState(canonical, {
      dirtyTreeFingerprint: 'dirty-a',
      touchedFiles: ['scripts/lib/run-state.mjs'],
      latestFailure: 'focused RED',
      latestTest: 'node --test test/run-recovery-072.test.mjs',
      nextAction: 'finish interruption-safe persistence',
      nextCommand: 'node --test test/run-recovery-072.test.mjs'
    });
    canonical.current_checkpoint = {
      schema_version: 1,
      mission_digest: 'bounded recovery',
      invariants_and_non_goals: [],
      current_architecture: ['run.json is canonical'],
      completed_slice_commits: [],
      evidence_receipts: [],
      open_findings: [],
      unavailable_evidence: [],
      exact_next_slice: 'finish interruption-safe persistence',
      relevant_files_and_interfaces: ['scripts/lib/run-state.mjs'],
      budget_position: {}
    };

    await assert.rejects(
      persistRunStateAndProjections(runtime, canonical, {
        afterCanonicalWrite() {
          throw new Error('simulated interruption after run.json');
        }
      }),
      /simulated interruption/
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8')),
      canonical
    );

    const reconciled = await reconcileRunProjections(runtime);
    assert.equal(reconciled.status, 'RUN_PROJECTIONS_RECONCILED');
    assert.deepEqual(
      JSON.parse(await readFile(path.join(runtime, 'checkpoints/current.json'), 'utf8')),
      canonical.current_checkpoint
    );
    assert.equal(await readFile(path.join(runtime, 'run.md'), 'utf8'), projectRunMarkdown(canonical));
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});
