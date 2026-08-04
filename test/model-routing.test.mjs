import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  digestJson,
  loadConfigLayers,
  resolveUserConfigPath
} from '../scripts/lib/config-layers.mjs';
import {
  assertAuthoritativeProposal,
  createModelProposal,
  normalizeCapabilityClass,
  resolveRoutingProposal,
  summarizeRoutingObservations
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
    catalogDigest: 'catalog-a',
    sessionId: 'session-1'
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
      writeFile(user, JSON.stringify({ routing: { mode: 'recommend', policy: 'quality_first', mappings: { balanced: [{ model: 'user-balanced' }] } }, marker: 'user' })),
      writeFile(project, JSON.stringify({ routing: { mode: 'map_only', mappings: { economy: [{ model: 'project-economy' }] } }, marker: 'project' })),
      writeFile(run, JSON.stringify({ routing: { policy: 'balanced', mappings: { expert: [{ model: 'run-expert' }] } }, marker: 'run' }))
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
    assert.deepEqual(resolved.mapping_sources, {
      balanced: 'user', economy: 'git_local_project', expert: 'per_run'
    });
    assert.match(resolved.digest, /^[0-9a-f]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('DEL-003 and ROUTE-001: proposal task role must match the selected bounded role', () => {
  assert.throws(() => createModelProposal({
    delegation: selected,
    phase: 'dispatch',
    sessionId: 'session-1',
    capabilityClass: 'balanced',
    reasoningEffort: 'medium',
    taskSignature: { role: 'different-role', risk: 'standard' }
  }), /task.*role|delegation.*role|mismatch/i);
});

test('ROUTE-005: dispatch proposals require a physical session binding', () => {
  assert.throws(() => createModelProposal({
    delegation: selected, phase: 'dispatch', capabilityClass: 'balanced',
    reasoningEffort: 'medium', taskSignature: { role: selected.role }
  }), /session/i);
});

function dispatchProposal(overrides = {}) {
  return createModelProposal({
    delegation: selected,
    phase: 'dispatch',
    capabilityClass: 'economy',
    reasoningEffort: 'low',
    taskSignature: { role: 'bounded_implementer', risk: 'standard', traits: ['mechanical'], proof_kind: 'focused' },
    mode: 'auto_within_policy',
    policy: 'cost_optimized',
    gitFingerprint: 'git-a',
    configDigest: 'config-a',
    mappingDigest: 'mapping-a',
    harness: 'codex',
    harnessVersion: '0.146',
    capabilityDigest: 'cap-a',
    catalogDigest: 'catalog-a',
    sessionId: 'session-1',
    ...overrides
  });
}

const mappings = {
  economy: [
    { model: 'cheap-first', effort: 'low', quality_rank: 5, balanced_rank: 4, cost_rank: 1 },
    { model: 'cheap-second', effort: 'medium', quality_rank: 4, balanced_rank: 3, cost_rank: 1 }
  ],
  balanced: [
    { model: 'balanced-best', effort: 'medium', quality_rank: 1, balanced_rank: 1, cost_rank: 4 }
  ],
  expert: [
    { model: 'expert-best', effort: 'high', quality_rank: 0, balanced_rank: 3, cost_rank: 9 }
  ]
};

const catalog = {
  status: 'current',
  available_models: ['cheap-first', 'cheap-second', 'balanced-best', 'expert-best'],
  supported_efforts: ['low', 'medium', 'high'],
  digest: 'catalog-a'
};

test('ROUTE-003: every mode is deterministic and mapping ties preserve declaration order', () => {
  let resolution = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'inherit' }), mappings, catalog
  });
  assert.equal(resolution.action, 'inherit');
  assert.equal(resolution.requested_model, 'inherit');

  resolution = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'recommend' }), mappings, catalog
  });
  assert.equal(resolution.action, 'inherit');
  assert.equal(resolution.recommendation.model, 'cheap-first');

  resolution = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'map_only' }), mappings, catalog
  });
  assert.equal(resolution.action, 'request');
  assert.equal(resolution.requested_model, 'cheap-first');

  resolution = resolveRoutingProposal({ proposal: dispatchProposal(), mappings, catalog });
  assert.equal(resolution.requested_model, 'cheap-first', 'equal cost ranks preserve declaration order');
});

test('ROUTE-003: policies constrain deterministic escalation to at most one class', () => {
  const quality = resolveRoutingProposal({
    proposal: dispatchProposal({ policy: 'quality_first' }), mappings, catalog
  });
  assert.equal(quality.selected_class, 'balanced');
  assert.equal(quality.requested_model, 'balanced-best');
  assert.equal(quality.class_escalations, 1);

  const balanced = resolveRoutingProposal({
    proposal: dispatchProposal({ policy: 'balanced' }), mappings, catalog
  });
  assert.equal(balanced.selected_class, 'balanced');
  assert.equal(balanced.requested_model, 'balanced-best');

  const cost = resolveRoutingProposal({ proposal: dispatchProposal(), mappings, catalog });
  assert.equal(cost.selected_class, 'economy');
  assert.equal(cost.class_escalations, 0);
});

test('ROUTE-005: unavailable and unsupported candidates fall back truthfully', () => {
  const noCatalog = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'map_only' }), mappings,
    catalog: { status: 'unverified', available_models: [] }
  });
  assert.equal(noCatalog.action, 'inherit');
  assert.equal(noCatalog.availability, 'unverified');
  assert.match(noCatalog.fallback_trace.join(' '), /catalog|available/i);

  const unsupportedEffort = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'map_only' }), mappings: {
      economy: [{ model: 'cheap-first', effort: 'maximum' }]
    }, catalog
  });
  assert.equal(unsupportedEffort.action, 'request');
  assert.equal(unsupportedEffort.requested_model, 'cheap-first');
  assert.equal(unsupportedEffort.requested_effort, 'inherit');
  assert.match(unsupportedEffort.fallback_trace.join(' '), /effort/i);
});

test('ROUTE-005: strict cost cancels optional work and blocks required review when enforcement cannot be proved', () => {
  const strict = dispatchProposal({ policy: 'cost_optimized' });
  const optional = resolveRoutingProposal({
    proposal: strict, mappings, catalog, strictCost: true,
    enforcement: 'unverified', effectiveReporting: 'unverified', delegationRequirement: 'optional'
  });
  assert.equal(optional.action, 'cancel');
  assert.equal(optional.return_to_owner, true);

  const review = resolveRoutingProposal({
    proposal: strict, mappings, catalog, strictCost: true,
    enforcement: 'unverified', effectiveReporting: 'unverified', delegationRequirement: 'required_review'
  });
  assert.equal(review.action, 'blocked');
  assert.equal(review.policy_exception_required, true);
  assert.doesNotMatch(review.fallback_trace.join(' '), /silent/i);
});

test('ROUTE-004 and ROUTE-005: explicit overrides outrank inherit and are fingerprint inputs', () => {
  const override = { model: 'operator-choice', effort: 'high' };
  const proposal = dispatchProposal({
    mode: 'inherit',
    explicitOverrideDigest: digestJson(override)
  });
  const overridden = resolveRoutingProposal({
    proposal,
    explicitOverride: override,
    catalog: { ...catalog, available_models: [...catalog.available_models, 'operator-choice'] }
  });
  assert.equal(overridden.action, 'request');
  assert.equal(overridden.requested_model, 'operator-choice');
  assert.throws(() => resolveRoutingProposal({
    proposal,
    currentInputs: {
      delegationId: proposal.delegation_id,
      taskSignature: proposal.task_signature,
      gitFingerprint: proposal.git_fingerprint,
      configDigest: proposal.config_digest,
      mappingDigest: proposal.mapping_digest,
      harness: proposal.harness,
      harnessVersion: proposal.harness_version,
      capabilityDigest: proposal.capability_digest,
      catalogDigest: proposal.catalog_digest,
      explicitOverrideDigest: digestJson({ model: 'changed-choice' })
    },
    explicitOverride: { model: 'changed-choice' },
    catalog
  }), /stale|fingerprint/i);
});

test('ROUTE-005: harness, version, capability, provider, and effort constraints are enforced', () => {
  const constrained = {
    economy: [{
      model: 'constrained', provider: 'provider-a', effort: 'high',
      harnesses: ['claude'], minimum_harness_version: '2.0.0',
      required_capabilities: ['model_routing_enforcement']
    }]
  };
  let result = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'map_only' }), mappings: constrained,
    catalog: { status: 'current', models: [{ model: 'constrained', provider: 'provider-a' }] },
    capabilityEvidence: { model_routing_enforcement: 'native' }
  });
  assert.equal(result.action, 'inherit');
  assert.match(result.fallback_trace.join(' '), /harness/i);

  result = resolveRoutingProposal({
    proposal: dispatchProposal({ mode: 'map_only', harness: 'claude', harnessVersion: '2.1.0' }),
    mappings: constrained,
    catalog: { status: 'current', models: [{ model: 'constrained', provider: 'provider-a' }] },
    capabilityEvidence: { model_routing_enforcement: 'native' }
  });
  assert.equal(result.action, 'request');
  assert.equal(result.requested_model, 'constrained');
  assert.equal(result.requested_provider, 'provider-a');
  assert.equal(result.requested_effort, 'inherit', 'absent effort evidence cannot prove support');
  assert.match(result.fallback_trace.join(' '), /effort.*unverified/i);
});

test('ROUTE-006: empirical summaries require three exact categorical matches and never return policy mutations', () => {
  const signature = dispatchProposal().task_signature;
  const observations = [0, 1, 2].map((index) => ({
    id: `observation-${index}`,
    dispatch_id: `dispatch-${index}`,
    harness: 'codex',
    harness_version_family: '0.146',
    role: 'bounded_implementer',
    risk: 'standard',
    capability_class: 'economy',
    task_traits: ['mechanical'],
    proof_kind: 'focused',
    owner_acceptance: index === 2 ? 'rejected' : 'accepted',
    requested_model: 'cheap-first',
    effective_model: 'cheap-first'
  }));
  const below = summarizeRoutingObservations(observations.slice(0, 2), {
    harness: 'codex', harness_version_family: '0.146', capability_class: 'economy', ...signature
  });
  assert.equal(below.status, 'insufficient_evidence');
  const summary = summarizeRoutingObservations(observations, {
    harness: 'codex', harness_version_family: '0.146', capability_class: 'economy', ...signature
  });
  assert.equal(summary.status, 'advisory');
  assert.equal(summary.comparable_count, 3);
  assert.equal(summary.accepted_count, 2);
  assert.equal('mapping_update' in summary, false);
  assert.equal('policy_update' in summary, false);
  const duplicates = summarizeRoutingObservations([
    observations[0], { ...observations[0], id: 'duplicate-1' }, { ...observations[0], id: 'duplicate-2' }
  ], { harness: 'codex', harness_version_family: '0.146', capability_class: 'economy', ...signature });
  assert.equal(duplicates.status, 'insufficient_evidence', 'one dispatch cannot satisfy the threshold repeatedly');
});
