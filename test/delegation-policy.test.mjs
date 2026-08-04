import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  createModelProposal,
  validateDelegationDecision
} from '../scripts/lib/model-routing.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function tempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-delegation-'));
  assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  assert.equal(run('git', ['add', 'tracked.txt'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', 'base'], repo).status, 0);
  return repo;
}

test('DEL-001 and DEL-002: a non-selected delegation cannot produce a model proposal', () => {
  const decision = {
    schema_version: 1,
    id: 'delegation-inline',
    run_id: 'run-1',
    selected: false,
    reason: 'persistent owner retains the coherent implementation slice',
    inline_assessment: 'routing economics do not alter the delegation decision',
    created_at: '2026-08-04T00:00:00.000Z'
  };
  assert.deepEqual(validateDelegationDecision(decision), decision);
  assert.throws(
    () => createModelProposal({
      delegation: decision,
      phase: 'plan',
      capabilityClass: 'economy',
      reasoningEffort: 'low',
      taskSignature: { role: 'bounded_implementer' },
      mode: 'auto_within_policy',
      policy: 'cost_optimized'
    }),
    /delegation.*not selected|forbid.*proposal/i
  );
});

test('DEL-003: selected delegation requires every bounded execution field', () => {
  const base = {
    schema_version: 1,
    id: 'delegation-selected',
    run_id: 'run-1',
    selected: true,
    reason: 'isolated mechanical slice with a strong test oracle',
    inline_assessment: 'parallel isolation shortens the critical path',
    created_at: '2026-08-04T00:00:00.000Z'
  };
  assert.throws(() => validateDelegationDecision(base), /role/i);
  const complete = {
    ...base,
    role: 'bounded_implementer',
    ownership: ['path/a', 'path/b'],
    tool_restrictions: ['no_nested_agents', 'no_push'],
    dependency_cone: ['path/a', 'path/b'],
    stop_condition: 'focused acceptance proof passes',
    acceptance_proof: 'node --test test/focused.test.mjs'
  };
  assert.deepEqual(validateDelegationDecision(complete), complete);
});

test('delegation CLI records false before routing and cheap mappings cannot create a proposal', async () => {
  const repo = await tempRepo();
  try {
    const delegation = path.join(root, 'scripts/delegation-record.mjs');
    const routing = path.join(root, 'scripts/model-routing.mjs');
    let result = run(process.execPath, [
      delegation, 'decide', '--selected', 'false',
      '--reason', 'persistent owner retains the coherent implementation slice',
      '--inline-assessment', 'routing is irrelevant because delegation is not useful'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout.trim());
    assert.equal(decision.selected, false);

    const userConfig = path.join(repo, 'cheap.json');
    await writeFile(userConfig, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'auto_within_policy',
        policy: 'cost_optimized',
        mappings: { economy: [{ model: 'local-cheap-model', cost_rank: 1 }] }
      }
    }));
    result = run(process.execPath, [
      routing, 'propose', '--phase', 'plan', '--delegation-id', decision.id,
      '--capability-class', 'economy', '--reasoning-effort', 'low',
      '--task-signature', '{"role":"bounded_implementer"}', '--config', userConfig
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /delegation.*not selected|forbid.*proposal/i);

    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], repo).stdout.trim();
    const decisions = (await readFile(path.join(runtime, 'delegation/decisions.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(decisions.length, 1);
    await assert.rejects(readFile(path.join(runtime, 'routing/proposals.jsonl'), 'utf8'), /ENOENT/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('DEL-001, ROUTE-001, ROUTE-005: dispatch v2 consumes one authoritative proposal bound to a selected decision', async () => {
  const repo = await tempRepo();
  try {
    const delegation = path.join(root, 'scripts/delegation-record.mjs');
    const routing = path.join(root, 'scripts/model-routing.mjs');
    const dispatch = path.join(root, 'scripts/dispatch-record.mjs');
    let result = run(process.execPath, [
      delegation, 'decide', '--selected', 'true',
      '--reason', 'isolated mechanical slice with a strong test oracle',
      '--inline-assessment', 'parallel isolation shortens the critical path',
      '--role', 'bounded_implementer', '--ownership', 'path/a',
      '--tool-restrictions', 'no_nested_agents,no_push', '--dependency-cone', 'path/a',
      '--stop-condition', 'focused proof passes', '--acceptance-proof', 'node --test focused.test.mjs'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout.trim());

    result = run(process.execPath, [
      routing, 'propose', '--phase', 'dispatch', '--delegation-id', decision.id,
      '--capability-class', 'balanced', '--reasoning-effort', 'medium',
      '--task-signature', '{"role":"bounded_implementer","risk":"standard"}',
      '--mode', 'inherit', '--policy', 'balanced', '--harness', 'codex'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proposal = JSON.parse(result.stdout.trim());

    result = run(process.execPath, [routing, 'resolve', '--proposal-id', proposal.id], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resolution = JSON.parse(result.stdout.trim());
    assert.equal(resolution.action, 'inherit');

    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'edit path/a',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, '--turn-limit', '12'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const row = JSON.parse(result.stdout.trim());
    assert.equal(row.schema_version, 2);
    assert.equal(row.delegation_id, decision.id);
    assert.equal(row.proposal_id, proposal.id);
    assert.equal(row.requested_model, 'inherit');
    assert.equal(row.owner_acceptance.status, 'pending');

    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'reuse proposal',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /consumed|single-use/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('COMPAT-001: legacy dispatch records remain readable with capability-class aliases', async () => {
  const repo = await tempRepo();
  try {
    const dispatch = path.join(root, 'scripts/dispatch-record.mjs');
    let result = run(process.execPath, [dispatch, 'record', '--role', 'scout', '--purpose', 'inventory', '--tier', 'fast'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [dispatch, 'list', '--normalized'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const legacy = JSON.parse(result.stdout.trim());
    assert.equal(legacy.schema_version, 1);
    assert.equal(legacy.capability_class, 'economy');
    assert.equal(legacy.delegation_id, 'legacy_unavailable');
    assert.equal(legacy.availability, 'legacy_unavailable');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
