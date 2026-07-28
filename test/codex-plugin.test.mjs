import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { exists, json, read, root } from './helpers.mjs';

const marketplacePluginRoot = 'plugins/zimster';

test('Codex manifest follows the accepted ingestion shape', async () => {
  const manifest = await json('.codex-plugin/plugin.json');
  assert.equal(manifest.skills, './skills/');
  assert.equal(Object.hasOwn(manifest, 'hooks'), false, 'Codex rejects unsupported hooks fields');
  assert.match(manifest.description, /owner-driven|proof-first/i);
});

test('repo marketplace points at a local plugins/zimster directory', async () => {
  const marketplace = await json('.agents/plugins/marketplace.json');
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'zimster');
  assert.ok(entry, 'missing zimster marketplace entry');
  assert.deepEqual(entry.source, {
    source: 'local',
    path: './plugins/zimster'
  });
  assert.equal(await exists(`${marketplacePluginRoot}/.codex-plugin/plugin.json`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/skills/using-zimster/SKILL.md`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/scripts/evidence.mjs`), true);
  assert.equal(await exists(`${marketplacePluginRoot}/config/model-routing.json`), true);
});

test('Codex mirror is generated from canonical source without drift', async () => {
  const result = spawnSync(process.execPath, ['scripts/sync-codex-plugin.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
