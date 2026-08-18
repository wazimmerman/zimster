import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function pendingLocks(directory, lockName = 'state.lock') {
  return (await readdir(directory)).filter((entry) => entry.startsWith(`${lockName}.pending-`));
}

test('a paused creator fully stages ownership before exposing the canonical lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-staging-'));
  const lock = path.join(directory, 'state.lock');
  const staged = deferred();
  const publish = deferred();
  try {
    const acquisition = acquireOwnerLock(lock, {
      maxAttempts: 1,
      ownerId: 'paused-owner',
      onStaged: async ({ stagingPath, owner }) => {
        assert.equal(JSON.parse(await readFile(path.join(stagingPath, 'owner.json'), 'utf8')).owner_id, owner.owner_id);
        staged.resolve(stagingPath);
        await publish.promise;
      }
    });
    const stagingPath = await Promise.race([
      staged.promise,
      acquisition.then(() => {
        throw new Error('canonical lock was published without reaching the staged-owner boundary');
      })
    ]);
    assert.equal(await pathExists(lock), false);
    assert.equal(await pathExists(stagingPath), true);

    publish.resolve();
    const handle = await acquisition;
    assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).owner_id, handle.owner.owner_id);
    assert.equal(await pathExists(stagingPath), false);
    assert.equal(await handle.release(), true);
  } finally {
    publish.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a losing publisher cleans only its staging directory and cannot delete the new canonical owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-losing-publisher-'));
  const lock = path.join(directory, 'state.lock');
  const staged = deferred();
  const publish = deferred();
  try {
    const losingAcquisition = acquireOwnerLock(lock, {
      maxAttempts: 1,
      ownerId: 'paused-loser',
      onStaged: async ({ stagingPath }) => {
        staged.resolve(stagingPath);
        await publish.promise;
      }
    });
    const losingStagingPath = await staged.promise;
    const winner = await acquireOwnerLock(lock, { maxAttempts: 1, ownerId: 'published-winner' });
    publish.resolve();

    await assert.rejects(losingAcquisition, (error) => error.code === 'OWNER_LOCK_BUSY');
    assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).owner_id, winner.owner.owner_id);
    assert.equal(await pathExists(losingStagingPath), false);
    assert.deepEqual(await pendingLocks(directory), []);
    assert.equal(await winner.release(), true);
  } finally {
    publish.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test('two simultaneous publishers yield exactly one canonical owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-publish-race-'));
  const lock = path.join(directory, 'state.lock');
  const bothStaged = deferred();
  const publish = deferred();
  let stagedCount = 0;
  const onStaged = async () => {
    stagedCount += 1;
    if (stagedCount === 2) bothStaged.resolve();
    await publish.promise;
  };
  try {
    const acquisitions = [
      acquireOwnerLock(lock, { maxAttempts: 1, ownerId: 'publisher-one', onStaged }),
      acquireOwnerLock(lock, { maxAttempts: 1, ownerId: 'publisher-two', onStaged })
    ];
    await bothStaged.promise;
    assert.equal(await pathExists(lock), false);
    assert.deepEqual((await pendingLocks(directory)).sort(), [
      'state.lock.pending-'.concat(process.pid, '-publisher-one'),
      'state.lock.pending-'.concat(process.pid, '-publisher-two')
    ]);

    publish.resolve();
    const results = await Promise.allSettled(acquisitions);
    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, 'OWNER_LOCK_BUSY');

    const winner = winners[0].value;
    assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).owner_id, winner.owner.owner_id);
    assert.deepEqual(await pendingLocks(directory), []);
    assert.equal(await winner.release(), true);
  } finally {
    publish.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

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

test('a legacy incomplete canonical lock fails closed because it has no recoverable owner identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-lock-legacy-incomplete-'));
  const lock = path.join(directory, 'state.lock');
  try {
    await mkdir(lock);
    await assert.rejects(acquireOwnerLock(lock, {
      maxAttempts: 2,
      retryDelayMs: 1,
      incompleteGraceMs: 0
    }), (error) => error.code === 'OWNER_LOCK_BUSY');
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
