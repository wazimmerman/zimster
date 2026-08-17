import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const source = path.resolve(process.argv[2] || '.');
const head = process.argv[3];
if (!/^[0-9a-f]{40}$/.test(head || '')) {
  throw new Error('usage: selfhost-reconstruction.mjs <source> <head>');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-selfhost-reconstruction-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return String(result.stdout || '').trim();
}

try {
  const checkout = path.join(temporary, 'candidate');
  run('git', ['clone', '--quiet', '--no-hardlinks', source, checkout], temporary);
  run('git', ['checkout', '--quiet', '--detach', head], checkout);
  if (run('git', ['status', '--porcelain=v1'], checkout)) {
    throw new Error('fresh self-host checkout is not clean');
  }
  const tests = [
    'test/governed-execution.test.mjs',
    'test/assurance-accounting-cli.test.mjs',
    'test/durable-run-control.test.mjs',
    'test/control-plane-mutation.test.mjs',
    'test/coherence-preflight.test.mjs'
  ];
  run(process.execPath, ['--test', ...tests], checkout);
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    status: 'passed',
    candidate_head: head,
    reconstruction_checkout: 'fresh-detached-clone',
    durable_reconciliation_test_files: tests,
    mutable_live_projection_inputs: [],
    historical_gaps: 'reported separately by live coherence'
  })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
