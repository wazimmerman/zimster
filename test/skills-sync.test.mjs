import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { directories, exists, json, read, root } from './helpers.mjs';
import { syncSkills } from '../scripts/sync-skills.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function targetRepo() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'zimster-skills-sync-'));
  const repo = path.join(parent, 'target project');
  await mkdir(repo);
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await mkdir(path.join(repo, '.agents/skills/unrelated'), { recursive: true });
  await writeFile(path.join(repo, '.agents/skills/unrelated/SKILL.md'), '# Keep me\n');
  assert.equal(run('git', ['add', '.agents/skills/unrelated/SKILL.md'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return { parent, repo };
}

test('repository exposes the cross-platform skills synchronization command', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.scripts['sync-skills'], 'node scripts/sync-skills.mjs');
  assert.equal(await exists('scripts/sync-skills.mjs'), true);
});

test('direct script invocation recognizes a canonical-equivalent directory alias', async () => {
  const { parent, repo } = await targetRepo();
  const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'zimster-script-alias-'));
  try {
    const scriptsAlias = path.join(aliasRoot, 'scripts');
    await symlink(
      path.join(root, 'scripts'),
      scriptsAlias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const result = run(process.execPath, [
      path.join(scriptsAlias, 'sync-skills.mjs'), '--target', repo
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.notEqual(result.stdout.trim(), '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.target, await realpath(repo));
    const metadata = JSON.parse(await readFile(
      path.join(repo, '.agents/skills/using-zimster/references/build-metadata.json'),
      'utf8'
    ));
    assert.equal(metadata.package_target, 'skills-only');
  } finally {
    await rm(aliasRoot, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test('using-zimster carries version metadata and a quiet script-free fallback', async () => {
  const metadata = await json('skills/using-zimster/references/build-metadata.json');
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.semantic_version, (await json('package.json')).version);
  assert.equal(metadata.package_target, 'source');
  const skill = await read('skills/using-zimster/SKILL.md');
  assert.match(skill, /build-metadata\.json/);
  assert.match(skill, /script-free|scripts are unavailable/i);
  assert.match(skill, /do not warn|without a warning/i);
  assert.match(skill, /receipts.*unavailable|manually maintained receipts/is);
});

test('skills synchronization safely replaces owned skills and embeds build provenance', async () => {
  const { parent, repo } = await targetRepo();
  try {
    const destination = path.join(repo, '.agents/skills');
    await mkdir(path.join(destination, 'retired-zimster'), { recursive: true });
    await writeFile(path.join(destination, 'retired-zimster/SKILL.md'), '# stale\n');
    await writeFile(path.join(destination, '.zimster-install.json'), JSON.stringify({
      schema_version: 1,
      owned_skills: ['retired-zimster']
    }));

    const result = run(process.execPath, [
      path.join(root, 'scripts/sync-skills.mjs'), '--target', repo
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');

    const sourceSkills = await directories('skills');
    for (const skill of sourceSkills) {
      await readFile(path.join(destination, skill, 'SKILL.md'), 'utf8');
    }
    await assert.rejects(readFile(path.join(destination, 'retired-zimster/SKILL.md'), 'utf8'), /ENOENT/);
    assert.equal(await readFile(path.join(destination, 'unrelated/SKILL.md'), 'utf8'), '# Keep me\n');

    const metadata = JSON.parse(await readFile(
      path.join(destination, 'using-zimster/references/build-metadata.json'),
      'utf8'
    ));
    assert.equal(metadata.schema_version, 1);
    assert.equal(metadata.semantic_version, (await json('package.json')).version);
    assert.match(metadata.source_commit, /^[0-9a-f]{40}$/);
    assert.match(metadata.build_date, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(metadata.package_target, 'skills-only');
    assert.match(metadata.build_id, /^zimster-/);

    const registry = JSON.parse(await readFile(path.join(destination, '.zimster-install.json'), 'utf8'));
    assert.deepEqual(registry.owned_skills, sourceSkills);
    const excludePath = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], repo).stdout.trim();
    const exclude = await readFile(excludePath, 'utf8');
    assert.match(exclude, /# BEGIN ZIMSTER SKILLS/);
    assert.match(exclude, /\/\.agents\/skills\/using-zimster\//);
    assert.equal(run('git', ['status', '--short', '--untracked-files=all'], repo).stdout, '');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('skills synchronization dry-run and invalid targets make no changes', async () => {
  const { parent, repo } = await targetRepo();
  const invalid = await mkdtemp(path.join(os.tmpdir(), 'zimster-invalid-target-'));
  try {
    let result = run(process.execPath, [
      path.join(root, 'scripts/sync-skills.mjs'), '--target', repo, '--dry-run'
    ], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"dry_run":true/);
    await assert.rejects(readFile(path.join(repo, '.agents/skills/.zimster-install.json'), 'utf8'), /ENOENT/);

    result = run(process.execPath, [
      path.join(root, 'scripts/sync-skills.mjs'), '--target', invalid
    ], root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git repository|target/i);
    await assert.rejects(readFile(path.join(invalid, '.agents/skills/.zimster-install.json'), 'utf8'), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(invalid, { recursive: true, force: true });
  }
});

test('skills synchronization refuses an unowned name collision without changing it', async () => {
  const { parent, repo } = await targetRepo();
  try {
    const destination = path.join(repo, '.agents/skills');
    await mkdir(path.join(destination, 'using-zimster'), { recursive: true });
    await writeFile(path.join(destination, 'using-zimster/SKILL.md'), '# User-owned collision\n');

    const result = run(process.execPath, [
      path.join(root, 'scripts/sync-skills.mjs'), '--target', repo
    ], root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unowned|collision|already exists/i);
    assert.equal(
      await readFile(path.join(destination, 'using-zimster/SKILL.md'), 'utf8'),
      '# User-owned collision\n'
    );
    await assert.rejects(readFile(path.join(destination, '.zimster-install.json'), 'utf8'), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('skills synchronization rejects symlinked destination components before mutation', async () => {
  const { parent, repo } = await targetRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'zimster-skills-outside-'));
  try {
    await rm(path.join(repo, '.agents'), { recursive: true, force: true });
    await symlink(outside, path.join(repo, '.agents'), 'dir');
    await writeFile(path.join(outside, 'sentinel.txt'), 'outside\n');

    const result = run(process.execPath, [
      path.join(root, 'scripts/sync-skills.mjs'), '--target', repo
    ], root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|outside|unsafe/i);
    assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside\n');
    await assert.rejects(readFile(path.join(outside, 'skills/.zimster-install.json'), 'utf8'), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('skills synchronization preserves embedded provenance outside a Git checkout', async () => {
  const { parent, repo } = await targetRepo();
  const portable = await mkdtemp(path.join(os.tmpdir(), 'zimster-portable-extract-'));
  const sourceCommit = '1234567890abcdef1234567890abcdef12345678';
  const buildDate = '2026-07-27T12:34:56.000Z';
  try {
    await cp(path.join(root, 'scripts'), path.join(portable, 'scripts'), { recursive: true });
    await cp(path.join(root, 'skills'), path.join(portable, 'skills'), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(portable, 'package.json'));
    await writeFile(
      path.join(portable, 'skills/using-zimster/references/build-metadata.json'),
      `${JSON.stringify({
        schema_version: 1,
        semantic_version: (await json('package.json')).version,
        source_commit: sourceCommit,
        build_date: buildDate,
        build_id: `zimster-${(await json('package.json')).version}-${sourceCommit.slice(0, 12)}-portable`,
        package_target: 'portable'
      }, null, 2)}\n`
    );

    const result = run(process.execPath, [
      path.join(portable, 'scripts/sync-skills.mjs'), '--target', repo
    ], portable);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const metadata = JSON.parse(await readFile(
      path.join(repo, '.agents/skills/using-zimster/references/build-metadata.json'),
      'utf8'
    ));
    assert.equal(metadata.source_commit, sourceCommit);
    assert.equal(metadata.build_date, buildDate);
    assert.equal(metadata.package_target, 'skills-only');
    assert.match(metadata.build_id, new RegExp(sourceCommit.slice(0, 12)));
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(portable, { recursive: true, force: true });
  }
});

test('skills synchronization rolls back skill directories and metadata when exclusion update fails', async () => {
  const { parent, repo } = await targetRepo();
  try {
    const destination = path.join(repo, '.agents/skills');
    await mkdir(path.join(destination, 'retired-zimster'), { recursive: true });
    await writeFile(path.join(destination, 'retired-zimster/SKILL.md'), '# stale\n');
    const priorRegistry = `${JSON.stringify({
      schema_version: 1,
      owned_skills: ['retired-zimster']
    })}\n`;
    await writeFile(path.join(destination, '.zimster-install.json'), priorRegistry);
    const excludePath = run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
      repo
    ).stdout.trim();
    const priorExclude = '# keep this exclusion\n';
    await writeFile(excludePath, priorExclude);
    await assert.rejects(
      syncSkills({
        requestedTarget: repo,
        onPhase(phase) {
          if (phase === 'metadata-written') throw new Error('injected transaction failure');
        }
      }),
      /injected transaction failure/
    );

    assert.equal(
      await readFile(path.join(destination, 'retired-zimster/SKILL.md'), 'utf8'),
      '# stale\n'
    );
    assert.equal(await readFile(path.join(destination, '.zimster-install.json'), 'utf8'), priorRegistry);
    assert.equal(await readFile(excludePath, 'utf8'), priorExclude);
    await assert.rejects(readFile(path.join(destination, 'using-zimster/SKILL.md'), 'utf8'), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
