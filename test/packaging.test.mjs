import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';

async function bytes(file) {
  return readFile(file);
}

test('packaging is deterministic and emits Codex and Claude archives', async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), 'zimster-first-'));
  const second = await mkdtemp(path.join(os.tmpdir(), 'zimster-second-'));
  try {
    const firstOutputs = await createPackages(first);
    const secondOutputs = await createPackages(second);
    assert.deepEqual(firstOutputs.map((entry) => path.basename(entry)), [
      'zimster-0.1.0-claude.zip',
      'zimster-0.1.0-codex.zip',
      'zimster-0.1.0-portable.zip'
    ]);
    for (let index = 0; index < firstOutputs.length; index += 1) {
      assert.deepEqual(await bytes(firstOutputs[index]), await bytes(secondOutputs[index]));
    }
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});


test('packaging preserves unrelated files in the output directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'zimster-preserve-'));
  const sentinel = path.join(output, 'keep-me.txt');
  try {
    await writeFile(sentinel, 'unrelated');
    await createPackages(output);
    await access(sentinel);
    assert.equal((await readFile(sentinel, 'utf8')), 'unrelated');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
