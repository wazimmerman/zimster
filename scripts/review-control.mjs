import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from './lib/review-lifecycle.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const lifecycleFile = path.join(runtime, 'reviews', 'lifecycle.json');

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
    'dispatch-record-id': 'dispatchRecordId'
  };
  for (const [option, field] of Object.entries(fields)) {
    if (options[option] !== undefined) event[field] = String(options[option]);
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
  const state = applyReviewLifecycleEvent(await readLifecycle(), eventFromOptions());
  await writeLifecycle(state);
  writeLine(JSON.stringify(state));
  if (['CIRCUIT_BREAKER', 'STRATEGY_ESCALATION_REQUIRES_OWNER'].includes(state.status)) {
    process.exitCode = 2;
  }
} else if (action === 'status') {
  writeLine(JSON.stringify(await readLifecycle()));
} else {
  writeError('Usage: review-control.mjs <init|event|status> [options]');
  process.exitCode = 1;
}
