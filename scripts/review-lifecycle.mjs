import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue, runGit } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { evaluateCoherence } from './lib/coherence-preflight.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle,
  reconcileReviewLifecycle,
  reviewFindingFingerprint,
  validateReviewLifecycle
} from './lib/review-lifecycle.mjs';
import { executionBudgetProofReceiptPasses } from './lib/execution-budget.mjs';

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
  const candidate = {
    base_sha: required(options, 'base'),
    head_sha: required(options, 'head'),
    tree_sha: required(options, 'tree'),
    dirty_tree_fingerprint: required(options, 'dirty-tree-fingerprint'),
    semantic_contract_sha256: required(options, 'semantic-contract-sha256')
  };
  for (const field of ['base_sha', 'head_sha']) {
    const result = runGit(['cat-file', '-e', `${candidate[field]}^{commit}`], root, {
      allowFailure: true
    });
    if (result.status !== 0) {
      throw new Error(`${field} must identify an existing immutable Git commit`);
    }
  }
  const actualTree = gitValue(['rev-parse', `${candidate.head_sha}^{tree}`], root, null);
  if (actualTree !== candidate.tree_sha) {
    throw new Error('candidate tree_sha must equal the immutable head commit tree');
  }
  return candidate;
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

function coordinated(mutationType, operation, preflight = null) {
  return withControlPlaneMutation(runtime, root, {
    mutationType,
    // Seam state and the aggregate attempt ledger are separate durable stores.
    // Preserve the transaction marker if either write fails after the other.
    atomicFailure: false,
    preflight
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

async function authenticateDispositionEvidence(state, disposition, references) {
  const approvalDisposition = disposition === 'reviewer_rebutted_with_evidence'
    || disposition === 'non_load_bearing_deferral';
  if (state.status !== 'strategy_escalation_required' || !approvalDisposition) {
    return references;
  }
  if (!Array.isArray(references) || !references.length
    || !references.every((reference) =>
      typeof reference === 'string' && /^[A-Za-z0-9._-]+$/.test(reference))) {
    throw new Error('strategy approval evidence refs must be verification receipt IDs');
  }
  const attemptId = state.strategy_escalation?.attempt_id;
  const attempt = state.attempts.find(({ attempt_id }) => attempt_id === attemptId);
  if (!attempt || attempt.verdict !== 'needs_correction') {
    throw new Error('strategy approval requires the exhausted failed review attempt');
  }
  const expected = new Map(attempt.findings
    .filter(({ severity }) => severity === 'Critical' || severity === 'Important')
    .map((finding) => {
      const fingerprint = reviewFindingFingerprint(attemptId, finding);
      return [fingerprint, `review-finding:${attemptId}:${fingerprint}`];
    }));
  const authenticated = [];
  const covered = new Set();
  for (const receiptId of references) {
    const diagnostics = {};
    const valid = await executionBudgetProofReceiptPasses(runtime, {
      required_at: new Date().toISOString(),
      receipt_type: 'verification'
    }, receiptId, { cwd: root, diagnostics });
    if (!valid) {
      throw new Error(
        `review disposition evidence is not authenticated: ${receiptId} (${JSON.stringify(diagnostics)})`
      );
    }
    const receipt = JSON.parse(await readFile(
      path.join(runtime, 'verification', 'receipts', `${receiptId}.json`),
      'utf8'
    ));
    if (receipt.execution_id == null
      || receipt.git_commit !== state.candidate.head_sha
      || receipt.git_tree !== state.candidate.tree_sha
      || receipt.dirty_tree_fingerprint !== state.candidate.dirty_tree_fingerprint) {
      throw new Error(`review disposition evidence does not bind the exact candidate: ${receiptId}`);
    }
    const stepIds = [];
    const findingFingerprints = [];
    for (const step of receipt.steps || []) {
      if (step.status !== 'passed' || step.exit_code !== 0) continue;
      const establishes = new Set(step.establishes || []);
      const stepFindings = [...expected.entries()]
        .filter(([, token]) => establishes.has(token))
        .map(([fingerprint]) => fingerprint);
      if (!stepFindings.length) continue;
      stepIds.push(step.id);
      for (const fingerprint of stepFindings) {
        covered.add(fingerprint);
        if (!findingFingerprints.includes(fingerprint)) findingFingerprints.push(fingerprint);
      }
    }
    authenticated.push({
      receipt_type: 'verification',
      receipt_id: receipt.id,
      execution_id: receipt.execution_id,
      authentication: 'governed-execution-v1',
      candidate: structuredClone(state.candidate),
      environment: structuredClone(receipt.environment || {}),
      step_ids: stepIds,
      finding_fingerprints: findingFingerprints
    });
  }
  const uncovered = [...expected.keys()].filter((fingerprint) => !covered.has(fingerprint));
  if (uncovered.length) {
    throw new Error(
      `review disposition evidence does not rebut every load-bearing finding: ${uncovered.join(', ')}`
    );
  }
  return authenticated;
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
  const attemptType = required(options, 'attempt-type');
  const coherencePreflight = attemptType === 'final_integration_review'
    ? async () => {
        const coherence = await evaluateCoherence(runtime, root, {
          operation: 'review',
          seamId
        });
        if (coherence.status !== 'COHERENCE_CURRENT') {
          throw new Error(`COHERENCE_BLOCKED: ${coherence.issues.join('; ')}`);
        }
      }
    : null;
  state = await coordinated('review_attempt_started', () => mutate(async (current) => {
    const reviewPackage = await boundReviewPackage(current);
    const event = {
      type: 'attempt_started',
      attempt: {
        attempt_type: attemptType,
        attempt_id: required(options, 'attempt-id'),
        seam_id: seamId,
        reviewer_identity: required(options, 'reviewer-identity'),
        review_package_id: reviewPackage.id,
        candidate: current.candidate
      }
    };
    applyReviewLifecycleEvent(current, event);
    return event;
  }), coherencePreflight);
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
  state = await coordinated('review_candidate_updated', () => mutate((current) => ({
    type: current.status === 'approved'
      ? 'approved_candidate_updated_before_final_review'
      : 'candidate_updated_before_review',
    candidate: candidateFromOptions()
  })));
} else if (action === 'stabilize') {
  state = await coordinated('review_candidate_stabilized', () => mutate(() => ({
    type: 'candidate_stabilized'
  })));
} else if (action === 'disposition') {
  state = await coordinated('review_disposition_recorded', () => mutate(async (current) => {
    const disposition = required(options, 'disposition');
    return {
      type: 'breaker_disposition_recorded',
      disposition,
      reason: required(options, 'reason'),
      evidence_refs: await authenticateDispositionEvidence(
        current,
        disposition,
        jsonOption('evidence-refs', [])
      ),
      ...(options.head ? { candidate: candidateFromOptions() } : {})
    };
  }));
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
