import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalPath,
  directInvocation,
  repositoryRelativeIdentity,
  reviewFileIdentity
} from '../scripts/lib/path-identity.mjs';

test('canonical path identity collapses aliases and stays separator-neutral', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'zimster-path-identity-'));
  const repository = path.join(parent, 'repository');
  const alias = path.join(parent, 'repository-alias');
  try {
    await mkdir(path.join(repository, 'nested'), { recursive: true });
    await symlink(
      repository,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.equal(
      await repositoryRelativeIdentity(repository, path.join(alias, 'nested')),
      'nested'
    );
    assert.equal(
      await canonicalPath(path.join(alias, 'nested')),
      await realpath(path.join(repository, 'nested'))
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('repository-relative identity rejects a genuinely external path', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'zimster-path-repository-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'zimster-path-outside-'));
  try {
    await assert.rejects(
      repositoryRelativeIdentity(repository, outside),
      /outside.*repository/i
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('absolute review identities use canonical file URLs', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-repository-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-file-'));
  const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-file-alias-'));
  try {
    const file = path.join(outside, 'mission file.md');
    await writeFile(file, '# Mission\n');
    const alias = path.join(aliasRoot, 'outside');
    await symlink(
      outside,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.equal(
      await reviewFileIdentity(repository, path.join(alias, path.basename(file))),
      pathToFileURL(await realpath(file)).href
    );
  } finally {
    await rm(aliasRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(repository, { recursive: true, force: true });
  }
});

test('direct invocation compares canonical file identities', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'zimster-entry-identity-'));
  try {
    const directory = path.join(parent, 'scripts');
    const directoryAlias = path.join(parent, 'scripts-alias');
    await mkdir(directory);
    const script = path.join(directory, 'script.mjs');
    await writeFile(script, 'export {};\n');
    await symlink(
      directory,
      directoryAlias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.equal(
      await directInvocation(pathToFileURL(script).href, path.join(directoryAlias, 'script.mjs')),
      true
    );
    assert.equal(await directInvocation(pathToFileURL(script).href, null), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
