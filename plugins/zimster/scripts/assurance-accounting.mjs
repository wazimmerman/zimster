import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import {
  validateAssuranceAccounting,
  validateReviewLifecycle
} from './lib/review-lifecycle.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
if (positional[0] !== 'reconcile') {
  throw new Error('Usage: assurance-accounting.mjs reconcile --observed <json>');
}

const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const observedPath = path.resolve(process.cwd(), required(options, 'observed'));
const observed = JSON.parse(await readFile(observedPath, 'utf8'));
const checkout = await captureGitState(root);

async function jsonLines(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function json(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

const dispatches = await jsonLines(path.join(runtime, 'dispatches', 'dispatches.jsonl'));
const budget = await json(path.join(runtime, 'budget.json'), { optional_agent_identities: [] });
const lifecycleDirectory = path.join(runtime, 'review-lifecycle');
let lifecycleFiles = [];
try {
  lifecycleFiles = (await readdir(lifecycleDirectory)).filter((file) => file.endsWith('.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const lifecycleStates = await Promise.all(lifecycleFiles.map((file) =>
  json(path.join(lifecycleDirectory, file), null).then((state) => validateReviewLifecycle(state))
));

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))].sort();
}

const recordedReviewAttemptCounts = {
  correction_rechecks: lifecycleStates.flatMap(({ attempts = [] }) => attempts)
    .filter(({ attempt_type }) => attempt_type === 'correction_recheck').length,
  final_integration_reviews: lifecycleStates.flatMap(({ attempts = [] }) => attempts)
    .filter(({ attempt_type }) => attempt_type === 'final_integration_review').length
};

const receipt = {
  schema_version: 1,
  candidate_head: observed.candidate_head,
  candidate_tree: observed.candidate_tree,
  observed_agent_ids: sortedUnique(observed.observed_agent_ids || []),
  dispatch_agent_ids: sortedUnique(dispatches.map(({ agent_id }) => agent_id)),
  budget_agent_ids: sortedUnique(budget.optional_agent_identities || []),
  observed_review_attempt_ids: sortedUnique(observed.observed_review_attempt_ids || []),
  recorded_review_attempt_ids: sortedUnique(lifecycleStates.flatMap((state) =>
    (state.attempts || []).map(({ attempt_id }) => attempt_id)
  )),
  recorded_review_attempt_counts: recordedReviewAttemptCounts,
  budget_review_attempt_counts: {
    correction_rechecks: budget.usage?.correction_rechecks ?? 0,
    final_integration_reviews: budget.usage?.final_integration_reviews ?? 0
  },
  observed_max_depth: observed.observed_max_depth,
  allowed_max_depth: observed.allowed_max_depth,
  reconciliation_complete: observed.observation_complete === true,
  observed_at: observed.observed_at || null,
  source: observedPath,
  reasons: []
};

if (receipt.candidate_head !== checkout.head || receipt.candidate_tree !== checkout.tree) {
  receipt.reasons.push('host observation does not bind the current candidate head and tree');
}
try {
  validateAssuranceAccounting(receipt, {
    candidateHead: checkout.head,
    candidateTree: checkout.tree,
    recordedReviewAttemptIds: lifecycleStates.flatMap((state) =>
      (state.attempts || []).map(({ attempt_id }) => attempt_id)
    ),
    recordedReviewAttemptCounts,
    requiredReviewerIdentities: lifecycleStates.map(({ reviewer_identity }) => reviewer_identity)
  });
} catch (error) {
  receipt.reasons.push(error.message);
}
receipt.reconciliation_complete = receipt.reconciliation_complete && receipt.reasons.length === 0;

const directory = path.join(runtime, 'assurance-accounting');
const output = path.join(directory, 'latest.json');
const temporary = `${output}.temporary-${process.pid}-${Date.now()}`;
await mkdir(directory, { recursive: true });
try {
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}

writeLine(JSON.stringify(receipt));
if (!receipt.reconciliation_complete) {
  for (const reason of receipt.reasons) writeError(`UNRECONCILED: ${reason}`);
  process.exitCode = 2;
}
