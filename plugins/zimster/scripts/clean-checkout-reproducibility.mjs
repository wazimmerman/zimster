import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const source = path.resolve(process.argv[2] || '.');
const head = process.argv[3];
if (!/^[0-9a-f]{40}$/.test(head || '')) {
  throw new Error('usage: clean-checkout-reproducibility.mjs <source> <head>');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-repro-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return String(result.stdout || '').trim();
}

async function build(name) {
  const checkout = path.join(temporary, name);
  run('git', ['clone', '--quiet', '--no-hardlinks', source, checkout], temporary);
  run('git', ['checkout', '--quiet', '--detach', head], checkout);
  if (run('git', ['status', '--porcelain=v1'], checkout)) {
    throw new Error(`${name} is not clean before packaging`);
  }
  run(process.execPath, ['scripts/package.mjs'], checkout);
  const secretScan = JSON.parse(run(
    process.execPath,
    ['scripts/secret-scan.mjs', '--dist', 'dist'],
    checkout
  ));
  if (secretScan.status !== 'passed' || secretScan.archives !== 5) {
    throw new Error(`${name} source/artifact secret scan failed`);
  }
  const names = (await readdir(path.join(checkout, 'dist')))
    .filter((file) => /(?:\.zip|\.tgz)$/.test(file))
    .sort();
  if (names.length !== 5) throw new Error(`${name} produced ${names.length} artifacts`);
  const artifacts = {};
  for (const file of names) {
    const bytes = await readFile(path.join(checkout, 'dist', file));
    artifacts[file] = {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  }
  return {
    checkout_head: run('git', ['rev-parse', 'HEAD'], checkout),
    secret_scan: secretScan.status,
    artifacts
  };
}

try {
  const first = await build('first');
  const second = await build('second');
  if (JSON.stringify(first.artifacts) !== JSON.stringify(second.artifacts)) {
    throw new Error('independent clean-checkout artifacts are not byte-identical');
  }
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    status: 'passed',
    candidate_head: head,
    clean_checkouts: 2,
    secret_clean_checkouts: 2,
    artifact_count: Object.keys(first.artifacts).length,
    artifacts: first.artifacts
  })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
