import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import {
  parseReleaseEvidenceRefContents,
  parseReleaseEvidenceTagPayload
} from '../scripts/lib/release-evidence.mjs';
import { root } from './helpers.mjs';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/release-evidence.mjs'), ...args], {
    cwd, encoding: 'utf8'
  });
}

test('signed authorization accepts exactly one canonical JSON payload', () => {
  const payload = { schema_version: 1, version: '0.7.0' };
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  assert.deepEqual(parseReleaseEvidenceTagPayload(canonical), payload);
  assert.deepEqual(parseReleaseEvidenceRefContents(`${canonical}\n`), payload);
  for (const invalid of [
    `release approved\n${canonical}`,
    `${canonical}additional note\n`,
    `${JSON.stringify(payload)}\n`
  ]) {
    assert.throws(() => parseReleaseEvidenceTagPayload(invalid), /canonical.*payload/i);
  }
  assert.throws(
    () => parseReleaseEvidenceRefContents(`release approved\n${canonical}\n`),
    /canonical.*payload/i
  );
});

test('release evidence canonically binds authorization inputs and all five artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-release-evidence-'));
  try {
    const dist = path.join(directory, 'dist');
    await createPackages(dist);
    const semantic = path.join(directory, 'semantic.json');
    const matrix = path.join(directory, 'hosts.json');
    const verification = path.join(directory, 'verification.json');
    for (const [file, value] of [[semantic, { verdict: 'approved' }], [matrix, { hosts: [] }], [verification, { status: 'passed' }]]) {
      await writeFile(file, `${JSON.stringify(value)}\n`);
    }
    const output = path.join(directory, 'release-evidence.json');
    const commit = 'a'.repeat(40);
    const tree = 'b'.repeat(40);
    let result = run([
      'create', '--version', '0.7.2', '--tag', 'v0.7.2', '--channel', 'public_beta',
      '--commit', commit, '--tree', tree, '--standards-lock', 'config/standards-lock.json',
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--dist', dist, '--output', output
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(evidence.schema_version, 1);
    assert.equal(evidence.commit, commit);
    assert.equal(evidence.tree, tree);
    assert.deepEqual(evidence.artifacts.map(({ name }) => name), [
      'zimster-0.7.2-claude.zip', 'zimster-0.7.2-codex.zip',
      'zimster-0.7.2-openai.zip', 'zimster-0.7.2-portable.zip', 'zimster-0.7.2.tgz'
    ]);
    result = run([
      'verify', '--file', output, '--expected-tag', 'v0.7.2', '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', 'config/standards-lock.json',
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--dist', dist
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(verification, '{"status":"changed"}\n');
    result = run([
      'verify', '--file', output, '--expected-tag', 'v0.7.2', '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', 'config/standards-lock.json',
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--dist', dist
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verification.*digest/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('v0.6.0 baseline records the true immutable release object and rejects local archive provenance', async () => {
  const baseline = JSON.parse(await readFile(path.join(root, 'release/baselines/v0.6.0.json'), 'utf8'));
  assert.equal(baseline.tag, 'v0.6.0');
  assert.equal(baseline.commit, '9b128196dc058d92117edeaf0dcd670e946f67db');
  assert.equal(baseline.tree, 'c5cebddf1426ba8d488e5c4cc9f053823ad9483d');
  assert.equal(baseline.local_archives_trusted, false);
});
