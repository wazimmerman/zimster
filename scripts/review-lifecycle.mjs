import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { evaluateCoherence } from './lib/coherence-preflight.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle,
  reconcileReviewLifecycle,
  validateReviewLifecycle
} from './lib/review-lifecycle.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const directory = path.join(runtime, 'review-lifecycle');
const seamId = required(options, 'seam-id');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(seamId)) {
  throw new Error('--seam-id must be a stable safe identifier');
}
const stateFile = path.join(directory, `${seamId}.json`);
const attemptsFile = path.join(directory, 'attempts.jsonl');

function candidateFromOptions() {
  return {
    base_sha: required(options, 'base'),
    head_sha: required(options, 'head'),
    tree_sha: required(options, 'tree'),
    dirty_tree_fingerprint: required(options, 'dirty-tree-fingerprint'),
    semantic_contract_sha256: required(options, 'semantic-contract-sha256')
  };
}

function jsonOption(name, fallback = null) {
  if (!options[name]) return fallback;
  try {
    return JSON.parse(String(options[name]));
  } catch {
    throw new Error(`--${name} must be valid JSON`);
  }
}

async function readState() {
  try {
    return validateReviewLifecycle(JSON.parse(await readFile(stateFile, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`review lifecycle is not initialized: ${seamId}`);
    throw error;
  }
}

async function readRawState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`review lifecycle is not initialized: ${seamId}`);
    throw error;
  }
}

async function writeAtomically(file, contents) {
  const temporary = `${file}.temporary-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function persist(state) {
  await mkdir(directory, { recursive: true });
  await writeAtomically(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const attemptRows = [];
  const stateFiles = await readdir(directory);
  for (const file of stateFiles.filter((name) => name.endsWith('.json')).sort()) {
    const row = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    for (const attempt of row.attempts || []) {
      attemptRows.push({
        schema_version: 1,
        seam_id: row.seam_id,
        reviewer_identity: row.reviewer_identity,
        ...attempt
      });
    }
  }
  await writeAtomically(
    attemptsFile,
    attemptRows.map((row) => JSON.stringify(row)).join('\n') + (attemptRows.length ? '\n' : '')
  );
}

async function withLock(operation) {
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, `${seamId}.lock`);
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
  if (!acquired) throw new Error(`review lifecycle is busy: ${seamId}`);
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function mutate(eventFactory) {
  return withLock(async () => {
    const state = await readState();
    const next = applyReviewLifecycleEvent(state, await eventFactory(state));
    await persist(next);
    return next;
  });
}

function coordinated(mutationType, operation) {
  return withControlPlaneMutation(runtime, root, {
    mutationType,
    // Seam state and the aggregate attempt ledger are separate durable stores.
    // Preserve the transaction marker if either write fails after the other.
    atomicFailure: false
  }, operation);
}

async function boundReviewPackage(state) {
  const file = path.resolve(process.cwd(), required(options, 'review-package'));
  const reviewPackage = JSON.parse(await readFile(file, 'utf8'));
  if (!/^[0-9a-f]{24}$/.test(reviewPackage.id || '')
    || file !== path.join(runtime, 'reviews', reviewPackage.id, 'review-package.json')) {
    throw new Error('review package must be the canonical immutable Git-local package');
  }
  const attemptType = required(options, 'attempt-type');
  const attemptId = required(options, 'attempt-id');
  if (reviewPackage.schema_version !== 2
    || reviewPackage.attempt_type !== attemptType
    || reviewPackage.attempt_id !== attemptId
    || reviewPackage.seam_id !== seamId
    || reviewPackage.base !== state.candidate.base_sha
    || reviewPackage.head !== state.candidate.head_sha
    || reviewPackage.candidate_checkout?.tree !== state.candidate.tree_sha
    || reviewPackage.candidate_checkout?.dirty_tree_fingerprint
      !== state.candidate.dirty_tree_fingerprint
    || reviewPackage.semantic_contract?.sha256
      !== state.candidate.semantic_contract_sha256) {
    throw new Error('review package does not bind the exact attempt, seam, and semantic candidate');
  }
  return reviewPackage;
}

let state;
if (action === 'init') {
  state = await coordinated('review_lifecycle_initialized', () => withLock(async () => {
    try {
      await readFile(stateFile, 'utf8');
      throw new Error(`review lifecycle already exists: ${seamId}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const initial = createReviewLifecycle({
      seam_id: seamId,
      reviewer_identity: required(options, 'reviewer-identity'),
      candidate: candidateFromOptions()
    });
    await persist(initial);
    return initial;
  }));
} else if (action === 'start') {
  state = await coordinated('review_attempt_started', () => mutate(async (current) => {
    const reviewPackage = await boundReviewPackage(current);
    const event = {
      type: 'attempt_started',
      attempt: {
        attempt_type: required(options, 'attempt-type'),
        attempt_id: required(options, 'attempt-id'),
        seam_id: seamId,
        reviewer_identity: required(options, 'reviewer-identity'),
        review_package_id: reviewPackage.id,
        candidate: current.candidate
      }
    };
    applyReviewLifecycleEvent(current, event);
    if (event.attempt.attempt_type === 'final_integration_review') {
      const coherence = await evaluateCoherence(runtime, root, {
        operation: 'review',
        seamId
      });
      if (coherence.status !== 'COHERENCE_CURRENT') {
        throw new Error(`COHERENCE_BLOCKED: ${coherence.issues.join('; ')}`);
      }
    }
    return event;
  }));
} else if (action === 'verdict') {
  state = await coordinated('review_verdict_recorded', () => mutate(() => ({
    type: 'verdict_recorded',
    attempt_id: required(options, 'attempt-id'),
    verdict: required(options, 'verdict'),
    findings: jsonOption('findings', [])
  })));
} else if (action === 'correction') {
  state = await coordinated('review_correction_recorded', () => mutate(() => ({
    type: 'correction_recorded', candidate: candidateFromOptions()
  })));
} else if (action === 'candidate') {
  state = await coordinated('review_candidate_updated_before_review', () => mutate(() => ({
    type: 'candidate_updated_before_review', candidate: candidateFromOptions()
  })));
} else if (action === 'stabilize') {
  state = await coordinated('review_candidate_stabilized', () => mutate(() => ({
    type: 'candidate_stabilized'
  })));
} else if (action === 'disposition') {
  state = await coordinated('review_disposition_recorded', () => mutate(() => ({
    type: 'breaker_disposition_recorded',
    disposition: required(options, 'disposition'),
    reason: required(options, 'reason'),
    evidence_refs: jsonOption('evidence-refs', []),
    ...(options.head ? { candidate: candidateFromOptions() } : {})
  })));
} else if (action === 'reconcile') {
  state = await coordinated('review_policy_reconciled', () => withLock(async () => {
    const reconciled = reconcileReviewLifecycle(await readRawState());
    await persist(reconciled);
    return reconciled;
  }));
} else if (action === 'show') {
  state = await readState();
} else {
  throw new Error('Usage: review-lifecycle.mjs <init|start|verdict|correction|candidate|stabilize|disposition|reconcile|show> --seam-id <id> [options]');
}

writeLine(JSON.stringify(state));
