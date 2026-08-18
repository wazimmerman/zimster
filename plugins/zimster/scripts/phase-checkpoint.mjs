import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, integerOption, required } from './lib/cli.mjs';
import { captureGitState, changedFiles, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  appendRunEvent,
  checkpointRunState,
  persistRunStateAndProjections,
  readRunState,
  reconcileRunState,
  startRunSlice
} from './lib/run-state.mjs';

const REQUIRED_FIELDS = Object.freeze([
  'mission_digest',
  'invariants_and_non_goals',
  'current_architecture',
  'completed_slice_commits',
  'evidence_receipts',
  'open_findings',
  'unavailable_evidence',
  'exact_next_slice',
  'relevant_files_and_interfaces',
  'budget_position'
]);
const FORBIDDEN_FIELDS = new Set([
  'objective',
  'full_objective',
  'passing_logs',
  'logs',
  'full_logs',
  'prior_diffs',
  'diffs',
  'transcript',
  'transcripts',
  'complete_transcripts'
]);

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const checkpointFile = path.join(runtime, 'checkpoints', 'current.json');
const evidenceScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence.mjs');

function output(value) {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`);
}

function validateCheckpoint(input) {
  const pending = [input];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) {
        throw new Error(`checkpoint field ${key} is forbidden verbose context`);
      }
      pending.push(child);
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(input, field)) throw new Error(`checkpoint requires ${field}`);
  }
  if (typeof input.mission_digest !== 'string' || !input.mission_digest.trim()) {
    throw new Error('mission_digest must be a non-empty string');
  }
  if (input.mission_digest.length > 512) {
    throw new Error('mission_digest must be 512 characters or fewer');
  }
  if (typeof input.exact_next_slice !== 'string' || !input.exact_next_slice.trim()) {
    throw new Error('exact_next_slice must be a non-empty string');
  }
  for (const field of [
    'invariants_and_non_goals',
    'current_architecture',
    'completed_slice_commits',
    'evidence_receipts',
    'open_findings',
    'unavailable_evidence',
    'relevant_files_and_interfaces'
  ]) {
    if (!Array.isArray(input[field])) throw new Error(`${field} must be an array`);
  }
  if (!input.budget_position || Array.isArray(input.budget_position) || typeof input.budget_position !== 'object') {
    throw new Error('budget_position must be an object');
  }
  for (const receipt of input.evidence_receipts) {
    if (!receipt || typeof receipt !== 'object' || typeof receipt.id !== 'string' || !receipt.id) {
      throw new Error('evidence receipt references require an id');
    }
    if (!['valid', 'stale', 'unavailable'].includes(receipt.status)) {
      throw new Error(`evidence receipt ${receipt.id} requires valid, stale, or unavailable status`);
    }
    if (receipt.status === 'stale' && (
      typeof receipt.invalidation_reason !== 'string'
      || !receipt.invalidation_reason.trim()
    )) {
      throw new Error(`stale evidence receipt ${receipt.id} requires invalidation_reason`);
    }
  }
}

async function verificationEvidenceReference(reference) {
  let receipt;
  try {
    receipt = JSON.parse(await readFile(
      path.join(runtime, 'verification', 'receipts', `${reference.id}.json`),
      'utf8'
    ));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let reason = null;
  if (receipt.status !== 'passed') reason = 'prior verification did not pass';
  const state = await captureGitState(root);
  if (!reason && receipt.git_commit !== state.head) reason = 'immutable Git commit changed';
  if (!reason && receipt.git_tree !== state.tree) reason = 'immutable Git tree changed';
  if (
    !reason
    && receipt.dirty_tree_fingerprint !== state.dirty_tree_fingerprint
  ) reason = 'dirty tree changed';
  const currentEnvironment = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version
  };
  if (
    !reason
    && JSON.stringify(receipt.environment || {}) !== JSON.stringify(currentEnvironment)
  ) reason = 'environment fingerprint changed';
  return reason
    ? { id: reference.id, status: 'stale', invalidation_reason: reason }
    : { id: reference.id, status: 'valid' };
}

async function actualEvidenceReference(reference) {
  if (reference.status === 'unavailable') return reference;
  const result = spawnSync(process.execPath, [
    evidenceScript, 'check', '--id', reference.id
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  if (result.status === 0) return { id: reference.id, status: 'valid' };
  if (result.status === 2) {
    const prefix = `STALE ${reference.id} `;
    const outputText = String(result.stdout || '').trim();
    return {
      id: reference.id,
      status: 'stale',
      invalidation_reason: outputText.startsWith(prefix)
        ? outputText.slice(prefix.length)
        : 'evidence check reported stale'
    };
  }
  const verificationReference = await verificationEvidenceReference(reference);
  if (verificationReference) return verificationReference;
  throw new Error(
    `cannot verify evidence receipt ${reference.id}: ${
      String(result.stderr || result.stdout || 'evidence check failed').trim()
    }`
  );
}

async function reconcileEvidenceReferences(references, { requireDeclaredState = false } = {}) {
  return Promise.all(references.map(async (reference) => {
    const actual = await actualEvidenceReference(reference);
    if (requireDeclaredState && actual.status !== reference.status) {
      throw new Error(
        `evidence receipt ${reference.id} is ${actual.status}, not declared ${reference.status}`
      );
    }
    if (
      requireDeclaredState
      && actual.status === 'stale'
      && actual.invalidation_reason !== reference.invalidation_reason
    ) {
      throw new Error(
        `stale evidence receipt ${reference.id} invalidation_reason differs from the ledger`
      );
    }
    return actual;
  }));
}

if (action === 'create') {
  const inputFile = path.resolve(process.cwd(), required(options, 'input'));
  const maxBytes = integerOption(options, 'max-bytes', 16 * 1024);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('--max-bytes must be a positive integer');
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  validateCheckpoint(input);
  input.evidence_receipts = await reconcileEvidenceReferences(input.evidence_receipts, {
    requireDeclaredState: true
  });
  const checkpoint = {
    schema_version: 1,
    ...Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, input[field]]))
  };
  const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > maxBytes) {
    throw new Error(`checkpoint is ${bytes} bytes; maximum is ${maxBytes}`);
  }
  let runState = await readRunState(runtime);
  if (!runState) throw new Error('checkpoint creation requires canonical run.json; initialize the run first');
  const gitState = await captureGitState(root);
  const files = changedFiles(root);
  if (!runState.current_slice) {
    runState = startRunSlice(runState, {
      id: input.current_slice?.id || 'in-progress',
      summary: input.current_slice?.summary || input.current_architecture.at(-1) || input.mission_digest,
      dirtyTreeFingerprint: gitState.dirty_tree_fingerprint,
      touchedFiles: files
    });
  }
  runState = checkpointRunState(runState, {
    dirtyTreeFingerprint: gitState.dirty_tree_fingerprint,
    touchedFiles: files,
    latestFailure: input.latest_failure || null,
    latestTest: input.latest_test || null,
    nextAction: input.next_slice?.summary || input.exact_next_slice,
    nextCommand: input.next_command || null
  });
  runState.next_slice = input.next_slice || {
    id: 'next',
    summary: input.exact_next_slice
  };
  runState.current_checkpoint = checkpoint;
  await persistRunStateAndProjections(runtime, runState);
  await appendRunEvent(runtime, { event_type: 'checkpoint_created' });
  output({ status: 'CHECKPOINT_CREATED', bytes, path: checkpointFile });
} else if (action === 'resume') {
  let runState = await readRunState(runtime);
  if (!runState) throw new Error('checkpoint resume requires canonical run.json');
  const checkpoint = runState.current_checkpoint
    || JSON.parse(await readFile(checkpointFile, 'utf8'));
  validateCheckpoint(checkpoint);
  checkpoint.evidence_receipts = await reconcileEvidenceReferences(checkpoint.evidence_receipts);
  runState.current_checkpoint = checkpoint;
  let resumeReconciliation = null;
  if (runState?.recovery) {
    const gitState = await captureGitState(root);
    resumeReconciliation = reconcileRunState(runState, {
      dirtyTreeFingerprint: gitState.dirty_tree_fingerprint,
      touchedFiles: changedFiles(root)
    });
    runState.recovery.dirty_tree_fingerprint = resumeReconciliation.current_dirty_tree_fingerprint;
    runState.recovery.touched_files = resumeReconciliation.touched_files;
  }
  await persistRunStateAndProjections(runtime, runState);
  await appendRunEvent(runtime, { event_type: 'run_resumed', actor_id: 'root' });
  output(resumeReconciliation ? { ...checkpoint, resume_reconciliation: resumeReconciliation } : checkpoint);
} else {
  throw new Error('Usage: phase-checkpoint.mjs <create|resume> [options]');
}
