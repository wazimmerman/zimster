import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireOwnerLock,
  releaseOwnerLock,
  renameOwnerLockPath,
  withOwnerLock
} from '../scripts/lib/owner-lock.mjs';

const ownerLockUrl = new URL('../scripts/lib/owner-lock.mjs', import.meta.url).href;

async function waitForFile(file, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await access(file);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${file}`);
}

test('a live owner lock is not stolen and release requires its nonce', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-live-'));
  const lock = path.join(directory, 'state.lock');
  try {
    const handle = await acquireOwnerLock(lock);
    await assert.rejects(
      acquireOwnerLock(lock, { maxAttempts: 2, retryDelayMs: 1 }),
      (error) => error.code === 'OWNER_LOCK_BUSY'
    );
    assert.equal(await releaseOwnerLock(lock, {
      ...handle.owner,
      owner_id: 'not-the-owner'
    }), false);
    assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).owner_id, handle.owner.owner_id);
    assert.equal(await handle.release(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows transient EPERM retries without weakening ownership-aware rename', async () => {
  let attempts = 0;
  const result = await renameOwnerLockPath('source', 'destination', {
    platform: 'win32',
    maxAttempts: 4,
    retryDelayMs: 0,
    operation: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('transient Windows directory handle');
        error.code = 'EPERM';
        throw error;
      }
    }
  });
  assert.equal(result, true);
  assert.equal(attempts, 3);

  await assert.rejects(renameOwnerLockPath('source', 'destination', {
    platform: 'linux',
    operation: async () => {
      const error = new Error('permission denied');
      error.code = 'EPERM';
      throw error;
    }
  }), /permission denied/);
});

test('fresh incomplete owner metadata fails closed instead of being stolen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-fresh-'));
  const lock = path.join(directory, 'state.lock');
  try {
    await mkdir(lock);
    await assert.rejects(
      acquireOwnerLock(lock, {
        maxAttempts: 2,
        retryDelayMs: 1,
        incompleteGraceMs: 60_000
      }),
      (error) => error.code === 'OWNER_LOCK_BUSY'
    );
    await access(lock);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a subsequent owner recovers after a holder and an initial reclaimer die', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-dead-'));
  const lock = path.join(directory, 'state.lock');
  const ready = path.join(directory, 'ready');
  const childScript = path.join(directory, 'holder.mjs');
  try {
    await writeFile(childScript, [
      `import { acquireOwnerLock } from ${JSON.stringify(ownerLockUrl)};`,
      "import { writeFile } from 'node:fs/promises';",
      'await acquireOwnerLock(process.argv[2]);',
      "await writeFile(process.argv[3], 'ready\\n');",
      'setInterval(() => {}, 1000);'
    ].join('\n'));
    const child = spawn(process.execPath, [childScript, lock, ready], { stdio: 'ignore' });
    await waitForFile(ready);
    child.kill();
    await new Promise((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    await mkdir(path.join(lock, '.reclaim'));

    const recovered = await acquireOwnerLock(lock, { maxAttempts: 20, retryDelayMs: 2 });
    assert.notEqual(recovered.owner.pid, child.pid);
    assert.equal(await recovered.release(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two contenders reclaim one stale lock without overlapping ownership', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-race-'));
  const lock = path.join(directory, 'state.lock');
  try {
    await mkdir(lock);
    await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({
      schema_version: 1,
      pid: 2147483647,
      owner_id: 'dead-owner',
      acquired_at: '2026-08-17T00:00:00.000Z'
    })}\n`);
    let active = 0;
    let maximumActive = 0;
    const run = () => withOwnerLock(lock, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    }, { maxAttempts: 200, retryDelayMs: 2 });
    await Promise.all([run(), run()]);
    assert.equal(maximumActive, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
