import { writeSync } from 'node:fs';
import { parseOptions, required } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { evaluateCoherence } from './lib/coherence-preflight.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
if (positional[0] !== 'check') {
  throw new Error('Usage: coherence-preflight.mjs check --operation review|completion|release [--profile micro|standard|high-risk] [--seam-id id]');
}
const repo = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(repo);
const report = await evaluateCoherence(runtime, repo, {
  operation: required(options, 'operation'),
  seamId: options['seam-id'] ? String(options['seam-id']) : 'whole-release',
  profile: options.profile ? String(options.profile) : 'high-risk'
});
writeSync(process.stdout.fd, `${JSON.stringify(report)}\n`);
if (report.status !== 'COHERENCE_CURRENT') process.exitCode = 2;
