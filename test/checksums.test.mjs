import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import { json, root } from './helpers.mjs';

test('checksum manifest covers every generated archive deterministically', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'zimster-checksums-'));
  try {
    const archives = await createPackages(output);
    const result = spawnSync(process.execPath, ['scripts/checksums.mjs', output], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const { version } = await json('package.json');
    const manifest = await readFile(path.join(output, `zimster-${version}-SHA256SUMS.txt`), 'utf8');
    for (const archive of archives) assert.match(manifest, new RegExp(`${path.basename(archive).replaceAll('.', '\\.')}$`, 'm'));
    assert.equal(manifest.trim().split('\n').length, archives.length);

    let check = spawnSync(process.execPath, ['scripts/checksums.mjs', '--check', output], {
      cwd: root, encoding: 'utf8'
    });
    assert.equal(check.status, 0, check.stderr || check.stdout);
    await writeFile(archives[0], 'tampered\n');
    check = spawnSync(process.execPath, ['scripts/checksums.mjs', '--check', output], {
      cwd: root, encoding: 'utf8'
    });
    assert.notEqual(check.status, 0, check.stderr || check.stdout);
    assert.match(check.stderr, /checksum mismatch/i);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
