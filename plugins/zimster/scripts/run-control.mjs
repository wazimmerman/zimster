import { writeSync } from 'node:fs';
import { parseOptions, required } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  checkpointRun,
  completeSlice,
  resumeRun,
  startSlice
} from './lib/run-control.mjs';
import { checkRunSummary, refreshRunSummary } from './lib/run-summary.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const repo = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(repo);

function output(value) {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`);
}

function jsonOption(name) {
  if (options[name] === undefined) return null;
  try {
    return JSON.parse(String(options[name]));
  } catch {
    throw new Error(`--${name} must be valid JSON`);
  }
}

if (action === 'start') {
  const result = await startSlice(runtime, repo, {
    sliceId: required(options, 'slice-id'),
    sliceTitle: options['slice-title'] ? String(options['slice-title']) : null,
    nextSliceId: options['next-slice-id'] ? String(options['next-slice-id']) : null,
    nextSliceTitle: options['next-slice-title'] ? String(options['next-slice-title']) : null,
    remainingObligations: jsonOption('remaining-obligations'),
    nextAction: options['next-action'] ? String(options['next-action']) : null,
    nextCommand: options['next-command'] ? String(options['next-command']) : null
  });
  output({ status: 'SLICE_STARTED', slice: result.state.current_slice });
} else if (action === 'checkpoint') {
  const checkpoint = await checkpointRun(runtime, repo, {
    status: options.status ? String(options.status) : null,
    completedObligations: jsonOption('completed-obligations'),
    remainingObligations: jsonOption('remaining-obligations'),
    corrections: jsonOption('corrections'),
    findings: jsonOption('findings'),
    guards: jsonOption('guards'),
    evidenceReceipts: jsonOption('evidence-receipts'),
    nextAction: options['next-action'] ? String(options['next-action']) : null,
    nextCommand: options['next-command'] ? String(options['next-command']) : null
  });
  output({ status: 'CHECKPOINT_CREATED', checkpoint });
} else if (action === 'resume') {
  const result = await resumeRun(runtime, repo);
  output(result.checkpoint);
  if (result.recoveryRequired) process.exitCode = 2;
} else if (action === 'complete') {
  const result = await completeSlice(runtime, repo, {
    verificationReceiptId: options['verification-receipt']
      ? String(options['verification-receipt'])
      : null,
    nextAction: options['next-action'] ? String(options['next-action']) : null,
    nextCommand: options['next-command'] ? String(options['next-command']) : null
  });
  output({ status: 'SLICE_COMPLETED', slice: result.state.completed_slices.at(-1) });
} else if (action === 'refresh') {
  await refreshRunSummary(runtime, { repo });
  output({ status: 'RUN_SUMMARY_REFRESHED' });
} else if (action === 'check') {
  const result = await checkRunSummary(runtime, { repo });
  if (result.current) output({ status: 'RUN_SUMMARY_CURRENT' });
  else {
    output({ status: 'STALE_RUN_SUMMARY' });
    process.exitCode = 2;
  }
} else {
  throw new Error('Usage: run-control.mjs <start|checkpoint|resume|complete|refresh|check> [options]');
}
