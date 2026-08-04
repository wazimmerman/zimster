import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadConfigLayers,
  resolveUserConfigPath
} from '../scripts/lib/config-layers.mjs';
import {
  assertAuthoritativeProposal,
  createModelProposal,
  normalizeCapabilityClass
} from '../scripts/lib/model-routing.mjs';
import { root } from './helpers.mjs';

const selected = {
  schema_version: 1,
  id: 'delegation-1',
  run_id: 'run-1',
  selected: true,
  role: 'bounded_implementer',
  reason: 'isolated mechanical slice with a strong test oracle',
  inline_assessment: 'parallel isolation shortens the critical path',
  ownership: ['path/a'],
  tool_restrictions: ['no_nested_agents'],
  dependency_cone: ['path/a'],
  stop_condition: 'focused proof passes',
  acceptance_proof: 'node --test focused.test.mjs',
  created_at: '2026-08-04T00:00:00.000Z'
};

test('ROUTE-001 and ROUTE-005: plan proposals are advisory and dispatch proposals are authoritative and single-use', () => {
  const common = {
    delegation: selected,
    capabilityClass: 'balanced',
    reasoningEffort: 'medium',
    taskSignature: { role: 'bounded_implementer', risk: 'standard' },
    mode: 'recommend',
    policy: 'balanced',
    gitFingerprint: 'git-a',
    configDigest: 'config-a',
    mappingDigest: 'mapping-a',
    harness: 'codex',
    harnessVersion: '0.146.0',
    capabilityDigest: 'cap-a',
    catalogDigest: 'catalog-a'
  };
  const plan = createModelProposal({ ...common, phase: 'plan' });
  assert.equal(plan.authority, 'advisory');
  assert.throws(() => assertAuthoritativeProposal(plan, common), /authoritative|dispatch/i);

  const dispatch = createModelProposal({ ...common, phase: 'dispatch' });
  assert.equal(dispatch.authority, 'authoritative');
  assert.equal(assertAuthoritativeProposal(dispatch, common), dispatch);
  assert.throws(
    () => assertAuthoritativeProposal({ ...dispatch, status: 'consumed' }, common),
    /consumed|active/i
  );
  assert.throws(
    () => assertAuthoritativeProposal(dispatch, { ...common, gitFingerprint: 'git-b' }),
    /stale|fingerprint|input/i
  );
  assert.throws(
    () => assertAuthoritativeProposal({ ...dispatch, superseded_by: 'proposal-2' }, common),
    /superseded/i
  );
});

test('ROUTE-002 and COMPAT-001: canonical classes and legacy aliases are stable', async () => {
  assert.equal(normalizeCapabilityClass('fast'), 'economy');
  assert.equal(normalizeCapabilityClass('standard'), 'balanced');
  assert.equal(normalizeCapabilityClass('expert'), 'expert');
  assert.equal(normalizeCapabilityClass('inherit'), 'inherit');
  const routing = JSON.parse(await readFile(path.join(root, 'config/model-routing.json'), 'utf8'));
  assert.deepEqual(Object.keys(routing.capability_classes), ['economy', 'balanced', 'expert', 'inherit']);
  assert.deepEqual(routing.legacy_aliases, { fast: 'economy', standard: 'balanced', expert: 'expert' });
  assert.equal(JSON.stringify(routing).includes('gpt-'), false);
  assert.equal(JSON.stringify(routing).includes('claude-'), false);
});

test('ROUTE-004: native user configuration paths are deterministic across operating systems', () => {
  assert.equal(resolveUserConfigPath({
    platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/test'
  }), '/xdg/zimster/config.json');
  assert.equal(resolveUserConfigPath({
    platform: 'linux', env: {}, home: '/home/test'
  }), '/home/test/.config/zimster/config.json');
  assert.equal(resolveUserConfigPath({
    platform: 'darwin', env: {}, home: '/Users/test'
  }), '/Users/test/Library/Application Support/Zimster/config.json');
  assert.equal(resolveUserConfigPath({
    platform: 'win32', env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, home: 'C:\\Users\\test'
  }), path.win32.join('C:\\Users\\test\\AppData\\Roaming', 'Zimster', 'config.json'));
});

test('ROUTE-004: configuration precedence is override, run, project, user, harness, inherit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-config-layers-'));
  try {
    const user = path.join(directory, 'user.json');
    const project = path.join(directory, 'project.json');
    const run = path.join(directory, 'run.json');
    await Promise.all([
      writeFile(user, JSON.stringify({ routing: { mode: 'recommend', policy: 'quality_first' }, marker: 'user' })),
      writeFile(project, JSON.stringify({ routing: { mode: 'map_only' }, marker: 'project' })),
      writeFile(run, JSON.stringify({ routing: { policy: 'balanced' }, marker: 'run' }))
    ]);
    const resolved = await loadConfigLayers({
      harnessNative: { routing: { mode: 'inherit', policy: 'cost_optimized' }, marker: 'harness' },
      userPath: user,
      projectPath: project,
      runPath: run,
      explicitOverride: { routing: { mode: 'auto_within_policy' }, marker: 'override' }
    });
    assert.deepEqual(resolved.precedence, [
      'explicit_dispatch_override', 'per_run', 'git_local_project',
      'user', 'harness_native', 'inherit'
    ]);
    assert.equal(resolved.effective.marker, 'override');
    assert.equal(resolved.effective.routing.mode, 'auto_within_policy');
    assert.equal(resolved.effective.routing.policy, 'balanced');
    assert.equal(resolved.layers.at(-1).source, 'explicit_dispatch_override');
    assert.match(resolved.digest, /^[0-9a-f]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
