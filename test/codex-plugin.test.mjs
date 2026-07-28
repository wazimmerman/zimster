import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists, json, read, root } from './helpers.mjs';

const marketplacePluginRoot = 'plugins/zimster';

test('Codex manifest follows the accepted ingestion shape', async () => {
  const manifest = await json('.codex-plugin/plugin.json');
  assert.equal(manifest.skills, './skills/');
  assert.equal(Object.hasOwn(manifest, 'hooks'), false, 'Codex rejects unsupported hooks fields');
  assert.match(manifest.description, /owner-driven|proof-first/i);
  assert.ok(Array.isArray(manifest.interface.defaultPrompt));
  assert.ok(manifest.interface.defaultPrompt.length > 0 && manifest.interface.defaultPrompt.length <= 3);
  assert.ok(manifest.interface.defaultPrompt.every((prompt) => typeof prompt === 'string' && prompt.length <= 128));
});

test('repo marketplace points at a local plugins/zimster directory', async () => {
  const marketplace = await json('.agents/plugins/marketplace.json');
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'zimster');
  assert.ok(entry, 'missing zimster marketplace entry');
  assert.deepEqual(entry.source, {
    source: 'local',
    path: './plugins/zimster'
  });
  assert.ok(['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(entry.policy.installation));
  assert.ok(['ON_INSTALL', 'ON_USE'].includes(entry.policy.authentication));
  assert.equal(await exists(`${marketplacePluginRoot}/.codex-plugin/plugin.json`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/skills/using-zimster/SKILL.md`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/scripts/evidence.mjs`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/config/model-routing.json`), true);
});

test('installed Codex README has no broken package-local documentation links', async () => {
  const readme = await read(`${marketplacePluginRoot}/README.md`);
  const links = [...readme.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^(?:[a-z]+:|#)/i.test(link));
  for (const link of links) {
    assert.equal(
      await exists(path.posix.join(marketplacePluginRoot, link)),
      true,
      `installed Codex README references missing ${link}`
    );
  }
  for (const guide of ['CURSOR', 'KIMI', 'OPENCODE', 'PI']) {
    assert.equal(
      await exists(`${marketplacePluginRoot}/docs/${guide}.md`),
      true,
      `installed Codex README names missing docs/${guide}.md`
    );
  }
});

test('Codex mirror is generated from canonical source without drift', async () => {
  const result = spawnSync(process.execPath, ['scripts/sync-codex-plugin.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Codex cachebuster replaces one build suffix without changing the release version', async () => {
  const pkg = await json('package.json');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-cachebuster-'));
  try {
    const plugin = path.join(temporary, 'zimster');
    await cp(path.join(root, marketplacePluginRoot), plugin, { recursive: true });
    const script = path.join(root, 'scripts/codex-cachebuster.mjs');
    let result = spawnSync(process.execPath, [script, plugin, '--cachebuster', 'local-test'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let manifest = JSON.parse(await readFile(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.version, `${pkg.version}+codex.local-test`);

    result = spawnSync(process.execPath, [script, plugin, '--cachebuster', 'next-test'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    manifest = JSON.parse(await readFile(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.version, `${pkg.version}+codex.next-test`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('vendored official Codex validator accepts the marketplace plugin', async () => {
  assert.equal(await exists('vendor/openai-codex-plugin-validator/manifest-contract.json'), true);
  const source = await read('vendor/openai-codex-plugin-validator/SOURCE.md');
  assert.match(source, /openai\/codex/i);
  assert.match(source, /Apache License 2\.0/i);

  const result = spawnSync(process.execPath, ['scripts/validate-codex.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('installed Codex package exposes quiet machine-readable diagnostics', async () => {
  const pkg = await json('package.json');
  const result = spawnSync(process.execPath, [
    path.join(root, marketplacePluginRoot, 'scripts/doctor.mjs'), '--json'
  ], {
    cwd: path.join(root, marketplacePluginRoot),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.zimster_version, pkg.version);
  assert.equal(report.package_target, 'codex');
  assert.equal(report.harnesses.codex.structural_status, 'ready');
});
