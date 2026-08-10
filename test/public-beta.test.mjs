import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { json, read } from './helpers.mjs';

test('REL-001: every public manifest identifies the 0.7.0 release candidate', async () => {
  const versions = [
    (await json('package.json')).version,
    (await json('package-lock.json')).version,
    (await json('.codex-plugin/plugin.json')).version,
    (await json('.claude-plugin/plugin.json')).version,
    (await json('.kimi-plugin/plugin.json')).version,
    (await json('.claude-plugin/marketplace.json')).plugins[0].version
  ];
  assert.deepEqual([...new Set(versions)], ['0.7.0']);
});

test('BETA-002: consolidated beta documentation covers every installation lifecycle and migration contract', async () => {
  for (const file of [
    'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/KNOWN_LIMITATIONS.md',
    'docs/MIGRATING-0.5.0.md'
  ]) {
    assert.ok((await read(file)).length > 400, `${file} is incomplete`);
  }
  const install = await read('docs/INSTALL.md');
  for (const phrase of [
    'Codex Git/custom marketplace', 'Claude Code GitHub marketplace',
    'Skills-only', 'Update', 'Rollback', 'Uninstall'
  ]) assert.match(install, new RegExp(phrase, 'i'));

  const configuration = await read('docs/CONFIGURATION.md');
  for (const phrase of [
    'recommend', 'map_only', 'auto_within_policy', 'inherit',
    'quality_first', 'balanced', 'cost_optimized', 'strict_cost',
    'per-run', 'Git-local', 'user', 'harness-native'
  ]) assert.match(configuration, new RegExp(phrase.replace('_', '[_-]'), 'i'));

  const migration = await read('docs/MIGRATING-0.5.0.md');
  assert.match(migration, /fast[\s\S]*economy/i);
  assert.match(migration, /standard[\s\S]*balanced/i);
  assert.match(migration, /dispatch v1[\s\S]*read/i);
  assert.match(migration, /routing\.mode[\s\S]*inherit/i);
});

test('BETA-001 and BETA-003: six beta surfaces use claim-scoped states and channel-specific live coverage', async () => {
  const hosts = await json('config/host-smoke.json');
  assert.deepEqual(hosts.hosts.map(({ id }) => id).sort(), [
    'claude', 'codex', 'grok', 'kimi', 'opencode', 'pi'
  ]);
  assert.equal(hosts.release_profiles.public_beta.minimum_live_verified_hosts, 1);
  assert.deepEqual(hosts.release_profiles.public_beta.required_live_host_ids, []);
  assert.equal(hosts.release_profiles.stable.minimum_live_verified_hosts, 6);
  assert.deepEqual([...hosts.release_profiles.stable.required_live_host_ids].sort(), [
    'claude', 'codex', 'grok', 'kimi', 'opencode', 'pi'
  ]);
  const receiptSchema = await json('schemas/host-smoke-receipt.schema.json');
  assert.deepEqual(receiptSchema.properties.hosts.items.properties.verification_state.enum, [
    'LIVE_VERIFIED', 'INSTALLED_PACKAGE_VERIFIED', 'STRUCTURALLY_VALIDATED',
    'BLOCKED_BY_AUTHENTICATION', 'UNAVAILABLE', 'UNSUPPORTED'
  ]);
  assert.equal(hosts.hosts.every(({ candidate }) => ['claude', 'codex', 'npm', 'portable'].includes(candidate)), true);
  assert.equal(hosts.hosts.every(({ proof_kind }) => proof_kind === 'exact_package_capability'), true);
  for (const harness of ['CLAUDE', 'CODEX', 'GROK', 'KIMI', 'OPENCODE', 'PI']) {
    const guide = await read(`docs/${harness}.md`);
    assert.match(
      guide,
      /LIVE_VERIFIED|INSTALLED_PACKAGE_VERIFIED|STRUCTURALLY_VALIDATED|BLOCKED_BY_AUTHENTICATION|UNAVAILABLE|UNSUPPORTED/,
      `${harness} lacks honest beta status`
    );
  }
  const readme = await read('README.md');
  for (const phrase of [
    'verification level', 'what was tested', 'what was not tested',
    'installation availability', 'known limitations'
  ]) assert.match(readme, new RegExp(phrase.replaceAll(' ', '\\s+'), 'i'));
  const compatibility = await read('docs/COMPATIBILITY.md');
  for (const version of ['0.146.1', '2.1.224', '1.0.0', '1.18.13', '0.84.1']) {
    assert.match(compatibility, new RegExp(version.replaceAll('.', '\\.')));
  }
  assert.match(compatibility, /Kimi[\s\S]*UNAVAILABLE/i);
});

test('BETA-002: privacy, diagnostics, contribution, and security contracts are public-beta ready', async () => {
  const privacy = await read('PRIVACY.md');
  assert.match(privacy, /Git-local/i);
  assert.doesNotMatch(privacy, /Local `\.zimster\/` run state/);
  assert.match(await read('docs/DIAGNOSTICS.md'), /model mapping[\s\S]*(redact|hidden|not reveal)/i);
  assert.match(await read('CONTRIBUTING.md'), /pull request|contribut/i);
  assert.match(await read('SECURITY.md'), /report[\s\S]*(vulnerab|security)/i);
});

test('REL-001: exact packages declare every routing and convergence contract', async () => {
  const packaging = await readFile('scripts/package.mjs', 'utf8');
  for (const relative of [
    'scripts/delegation-record.mjs', 'scripts/model-routing.mjs',
    'scripts/adapter-config.mjs', 'scripts/convergence.mjs',
    'schemas/delegation-decision.schema.json', 'schemas/model-proposal.schema.json',
    'schemas/routing-observation.schema.json', 'schemas/convergence-decision.schema.json',
    'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/KNOWN_LIMITATIONS.md',
    'docs/MIGRATING-0.5.0.md'
  ]) assert.match(packaging, new RegExp(relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
