import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const COLLISION_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM']);

export async function renameOwnerLockPath(source, destination, {
  operation = rename,
  platform = process.platform,
  maxAttempts = 200,
  retryDelayMs = 10,
  collisionCodes = []
} = {}) {
  const collisions = new Set(collisionCodes);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await operation(source, destination);
      return true;
    } catch (error) {
      if (platform === 'win32' && error.code === 'EPERM' && attempt + 1 < maxAttempts) {
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      if (collisions.has(error.code)) return false;
      throw error;
    }
  }
  return false;
}

function ownerRecord({ pid, ownerId, acquiredAt }) {
  return {
    schema_version: 1,
    pid,
    owner_id: ownerId,
    acquired_at: acquiredAt
  };
}

function validOwner(value) {
  return value?.schema_version === 1
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.owner_id === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.owner_id)
    && typeof value.acquired_at === 'string'
    && !Number.isNaN(Date.parse(value.acquired_at));
}

function processDisposition(pid) {
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error) {
    if (error.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

async function readOwner(lockPath) {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
    return validOwner(owner) ? { status: 'valid', owner } : { status: 'unknown' };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    try {
      const metadata = await stat(lockPath, { bigint: true });
      const identity = createHash('sha256').update([
        metadata.dev,
        metadata.ino,
        metadata.birthtimeNs
      ].join(':')).digest('hex').slice(0, 32);
      return {
        status: 'incomplete',
        modifiedAt: Number(metadata.mtimeNs / 1_000_000n),
        identity
      };
    } catch (statError) {
      if (statError.code === 'ENOENT') return { status: 'missing' };
      throw statError;
    }
  }
}

async function writeOwner(stagingPath, owner) {
  const ownerPath = path.join(stagingPath, 'owner.json');
  const handle = await open(ownerPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function tryCreate(lockPath, owner, { onStaged } = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const stagingPath = `${lockPath}.pending-${owner.pid}-${owner.owner_id}`;
  let stagingOwned = false;
  let published = false;
  try {
    await mkdir(stagingPath, { mode: 0o700 });
    stagingOwned = true;
  } catch (error) {
    if (COLLISION_CODES.has(error.code)) return false;
    throw error;
  }
  try {
    await writeOwner(stagingPath, owner);
    if (onStaged) await onStaged({ lockPath, owner, stagingPath });

    // Never replace an already-published lock, including a legacy incomplete
    // directory. New locks are complete before this atomic publication step.
    if ((await readOwner(lockPath)).status !== 'missing') return false;
    published = await renameOwnerLockPath(stagingPath, lockPath, {
      collisionCodes: process.platform === 'win32'
        ? [...COLLISION_CODES]
        : ['EEXIST', 'ENOTEMPTY']
    });
    return published;
  } finally {
    if (stagingOwned && !published) {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
}

function deadOwnerIdentity(observed) {
  return createHash('sha256').update([
    observed.pid,
    observed.owner_id,
    observed.acquired_at
  ].join(':')).digest('hex').slice(0, 32);
}

async function markReclaiming(lockPath) {
  try {
    await mkdir(path.join(lockPath, '.reclaim'));
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return true;
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function quarantineReclaim(lockPath, identity) {
  const quarantine = `${lockPath}.reclaimed-${identity}`;
  return renameOwnerLockPath(lockPath, quarantine, {
    collisionCodes: [...COLLISION_CODES, 'ENOENT']
  });
}

async function reclaimDeadOwner(lockPath, observed) {
  if (!await markReclaiming(lockPath)) return false;
  const current = await readOwner(lockPath);
  if (
    current.status !== 'valid'
    || current.owner.owner_id !== observed.owner_id
    || current.owner.pid !== observed.pid
    || processDisposition(current.owner.pid) !== 'dead'
  ) return false;
  return quarantineReclaim(lockPath, deadOwnerIdentity(observed));
}

export async function releaseOwnerLock(lockPath, owner) {
  const current = await readOwner(lockPath);
  if (
    current.status !== 'valid'
    || current.owner.owner_id !== owner.owner_id
    || current.owner.pid !== owner.pid
  ) return false;
  const quarantine = `${lockPath}.released-${owner.owner_id}`;
  if (!await renameOwnerLockPath(lockPath, quarantine, { collisionCodes: ['ENOENT'] })) return false;
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

export async function acquireOwnerLock(lockPath, {
  maxAttempts = 200,
  retryDelayMs = 10,
  incompleteGraceMs = 1000,
  pid = process.pid,
  ownerId = randomUUID(),
  acquiredAt = new Date().toISOString(),
  onStaged
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('owner lock maxAttempts must be positive');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) throw new Error('owner lock retryDelayMs must be non-negative');
  if (!Number.isInteger(incompleteGraceMs) || incompleteGraceMs < 0) throw new Error('owner lock incompleteGraceMs must be non-negative');
  if (onStaged !== undefined && typeof onStaged !== 'function') throw new Error('owner lock onStaged must be a function');
  const owner = ownerRecord({ pid, ownerId, acquiredAt });
  if (!validOwner(owner)) throw new Error('owner lock metadata is invalid');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await tryCreate(lockPath, owner, { onStaged })) {
      let released = false;
      return {
        owner,
        async release() {
          if (released) return false;
          released = await releaseOwnerLock(lockPath, owner);
          return released;
        }
      };
    }
    const observed = await readOwner(lockPath);
    if (
      observed.status === 'valid'
      && processDisposition(observed.owner.pid) === 'dead'
      && await reclaimDeadOwner(lockPath, observed.owner)
    ) continue;
    if (observed.status === 'incomplete') {
      // Legacy incomplete locks have no owner identity whose death can be
      // established. Fail closed instead of risking displacement of a paused
      // creator. New acquisition never exposes this state.
    }
    if (attempt + 1 < maxAttempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  const error = new Error('owner lock is busy; retry the mutation');
  error.code = 'OWNER_LOCK_BUSY';
  throw error;
}

export async function withOwnerLock(lockPath, operation, options = {}) {
  const handle = await acquireOwnerLock(lockPath, options);
  try {
    return await operation(handle.owner);
  } finally {
    await handle.release();
  }
}
