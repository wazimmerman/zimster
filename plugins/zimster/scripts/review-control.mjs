import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from './lib/review-lifecycle.mjs';
import { withOwnerLock } from './lib/owner-lock.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const lifecycleFile = path.join(runtime, 'reviews', 'lifecycle.json');
const lifecycleLock = path.join(runtime, 'reviews', 'lifecycle.lock');

async function readLifecycle() {
  return JSON.parse(await readFile(lifecycleFile, 'utf8'));
}

async function writeLifecycle(state, { createOnly = false } = {}) {
  await mkdir(path.dirname(lifecycleFile), { recursive: true });
  if (createOnly) {
    await writeFile(lifecycleFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  const temporary = `${lifecycleFile}.temporary-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, lifecycleFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

function eventFromOptions() {
  const type = required(options, 'type');
  const event = { type };
  const fields = {
    'reviewer-id': 'reviewerId',
    verdict: 'verdict',
    'candidate-digest': 'candidateDigest',
    'candidate-head': 'candidateHead',
    'candidate-tree': 'candidateTree',
    'review-package-id': 'reviewPackageId',
    'semantic-contract-sha256': 'semanticContractSha256',
    'review-record-id': 'reviewRecordId',
    'dispatch-record-id': 'dispatchRecordId',
    'previous-candidate-digest': 'previousCandidateDigest',
    'strategy-reason': 'strategyReason',
    'focused-proof-status': 'focusedProofStatus'
  };
  for (const [option, field] of Object.entries(fields)) {
    if (options[option] !== undefined) event[field] = String(options[option]);
  }
  if (options['material-change'] !== undefined) {
    if (!['true', 'false'].includes(String(options['material-change']))) {
      throw new Error('--material-change must be true or false');
    }
    event.materialChange = String(options['material-change']) === 'true';
  }
  return event;
}

if (action === 'init') {
  const run = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
  const state = createReviewLifecycle({
    runId: run.id,
    seamId: required(options, 'seam-id'),
    candidateDigest: required(options, 'candidate-digest')
  });
  await writeLifecycle(state, { createOnly: true });
  writeLine(JSON.stringify(state));
} else if (action === 'event') {
  const state = await withOwnerLock(lifecycleLock, async () => {
    const current = await readLifecycle();
    if (process.env.NODE_ENV === 'test' && process.env.ZIMSTER_TEST_REVIEW_HOLD_MS) {
      const delay = Number(process.env.ZIMSTER_TEST_REVIEW_HOLD_MS);
      if (Number.isFinite(delay) && delay > 0 && delay <= 1000) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const updated = applyReviewLifecycleEvent(current, eventFromOptions());
    await writeLifecycle(updated);
    return updated;
  });
  writeLine(JSON.stringify(state));
  if (['CIRCUIT_BREAKER', 'STRATEGY_ESCALATION_REQUIRES_OWNER', 'BLOCKED'].includes(state.status)) {
    process.exitCode = 2;
  }
} else if (action === 'status') {
  writeLine(JSON.stringify(await readLifecycle()));
} else {
  writeError('Usage: review-control.mjs <init|event|status> [options]');
  process.exitCode = 1;
}
