import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  createModelProposal,
  validateDelegationDecision
} from '../scripts/lib/model-routing.mjs';
import {
  appendActiveProposal,
  commitDispatchClaim,
  recoverProposalClaim,
  reserveProposalForDispatch,
  supersedeActiveProposal
} from '../scripts/lib/proposal-state.mjs';

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

test('ROUTE-005: proposal reservation is atomic and an interrupted claim recovers without duplicate dispatch', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-proposal-state-'));
  try {
    const proposal = {
      id: 'proposal-atomic',
      delegation_id: 'delegation-atomic',
      status: 'active',
      superseded_by: null
    };
    await appendActiveProposal(runtime, proposal);
    const attempts = await Promise.allSettled([
      reserveProposalForDispatch(runtime, proposal.id),
      reserveProposalForDispatch(runtime, proposal.id)
    ]);
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    const firstClaim = attempts.find(({ status }) => status === 'fulfilled').value.claim;
    assert.deepEqual(
      await recoverProposalClaim(runtime, proposal.id, firstClaim.id),
      { status: 'released', proposal_id: proposal.id, claim_id: firstClaim.id }
    );
    const retry = await reserveProposalForDispatch(runtime, proposal.id);
    const dispatch = {
      id: 'dispatch-atomic',
      proposal_id: proposal.id,
      proposal_claim_id: retry.claim.id
    };
    assert.deepEqual(await commitDispatchClaim(runtime, retry.claim.id, dispatch), dispatch);
    const recovery = await recoverProposalClaim(runtime, proposal.id, retry.claim.id);
    assert.deepEqual(recovery, {
      status: 'consumed',
      proposal_id: proposal.id,
      dispatch_id: dispatch.id
    });
    await assert.rejects(reserveProposalForDispatch(runtime, proposal.id), /single-use|consumed|claimed/i);
    const dispatches = (await readFile(path.join(runtime, 'dispatches/dispatches.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(dispatches.length, 1);

    const interrupted = {
      id: 'proposal-interrupted-dispatch',
      delegation_id: proposal.delegation_id,
      status: 'active',
      superseded_by: null
    };
    await appendActiveProposal(runtime, interrupted);
    const claims = path.join(runtime, 'routing/claims');
    await mkdir(claims, { recursive: true });
    const interruptedClaim = {
      schema_version: 1,
      id: 'claim-interrupted-dispatch',
      proposal_id: interrupted.id,
      purpose: 'dispatch',
      status: 'reserved',
      claimed_at: '2026-08-04T00:00:00.000Z'
    };
    await writeFile(
      path.join(claims, `${interrupted.id}.lock`),
      `${JSON.stringify(interruptedClaim)}\n`,
      { flag: 'wx' }
    );
    assert.deepEqual(
      await recoverProposalClaim(runtime, interrupted.id, interruptedClaim.id),
      { status: 'released', proposal_id: interrupted.id, claim_id: interruptedClaim.id }
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test('ROUTE-005: supersession and dispatch reservation cannot both claim one active proposal', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-proposal-supersession-'));
  try {
    const proposal = {
      id: 'proposal-original',
      delegation_id: 'delegation-atomic',
      status: 'active',
      superseded_by: null
    };
    const replacement = {
      id: 'proposal-replacement',
      delegation_id: proposal.delegation_id,
      status: 'active',
      superseded_by: null,
      supersedes: proposal.id
    };
    await appendActiveProposal(runtime, proposal);
    const attempts = await Promise.allSettled([
      reserveProposalForDispatch(runtime, proposal.id),
      supersedeActiveProposal(runtime, proposal.id, replacement)
    ]);
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    const rows = (await readFile(path.join(runtime, 'routing/proposals.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    const original = rows.find(({ id }) => id === proposal.id);
    assert.ok(['claimed', 'invalidated'].includes(original.status));
    assert.equal(rows.filter(({ id }) => id === replacement.id).length, original.status === 'invalidated' ? 1 : 0);

    const interrupted = {
      id: 'proposal-interrupted-supersession',
      delegation_id: proposal.delegation_id,
      status: 'active',
      superseded_by: null
    };
    await appendActiveProposal(runtime, interrupted);
    const claims = path.join(runtime, 'routing/claims');
    await mkdir(claims, { recursive: true });
    const interruptedClaim = {
      schema_version: 1,
      id: 'claim-interrupted-supersession',
      proposal_id: interrupted.id,
      purpose: 'supersession',
      status: 'reserved',
      replacement_proposal_id: 'proposal-never-written',
      claimed_at: '2026-08-04T00:00:00.000Z',
      completed_at: null
    };
    await writeFile(
      path.join(claims, `${interrupted.id}.lock`),
      `${JSON.stringify(interruptedClaim)}\n`,
      { flag: 'wx' }
    );
    assert.deepEqual(
      await recoverProposalClaim(runtime, interrupted.id, interruptedClaim.id),
      { status: 'released', proposal_id: interrupted.id, claim_id: interruptedClaim.id }
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
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
      '--mode', 'inherit', '--policy', 'balanced', '--harness', 'codex',
      '--session-id', 'session-1'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proposal = JSON.parse(result.stdout.trim());

    result = run(process.execPath, [
      routing, 'resolve', '--proposal-id', proposal.id,
      '--task-signature', '{"role":"bounded_implementer","risk":"standard"}',
      '--harness', 'codex', '--harness-version', 'unverified',
      '--capability-digest', 'unverified', '--catalog-digest', 'unverified',
      '--session-id', 'session-1'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resolution = JSON.parse(result.stdout.trim());
    assert.equal(resolution.action, 'inherit');
    const dispatchEvidence = [
      '--task-signature', '{"role":"bounded_implementer","risk":"standard"}',
      '--harness', 'codex', '--harness-version', 'unverified',
      '--capability-digest', 'unverified', '--catalog-digest', 'unverified',
      '--session-id', 'session-1'
    ];

    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], repo).stdout.trim();
    const resolutionFile = path.join(runtime, 'routing/resolutions.jsonl');
    await writeFile(resolutionFile, `${JSON.stringify({ ...resolution, action: 'cancel' })}\n`);
    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'must not launch',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, ...dispatchEvidence
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cancel|blocked|dispatchable/i);
    await writeFile(resolutionFile, `${JSON.stringify(resolution)}\n`);

    result = run(process.execPath, [
      dispatch, 'record', '--role', 'different-role', '--purpose', 'must not launch',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, ...dispatchEvidence
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /role.*delegation|mismatch/i);

    await writeFile(path.join(runtime, 'config.json'), JSON.stringify({
      schema_version: 1,
      routing: { mode: 'inherit', policy: 'balanced', mappings: {} }
    }));
    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'must not use stale config',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, ...dispatchEvidence
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /configuration layer changed|routing inputs changed|stale/i);
    await rm(path.join(runtime, 'config.json'));

    await writeFile(path.join(repo, 'stale-after-resolution.txt'), 'stale\n');
    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'must not launch stale work',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, ...dispatchEvidence
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale|fingerprint|tree|routing inputs changed/i);
    await rm(path.join(repo, 'stale-after-resolution.txt'));

    result = run(process.execPath, [
      dispatch, 'record', '--role', 'bounded_implementer', '--purpose', 'edit path/a',
      '--capability-class', 'balanced', '--delegation-id', decision.id,
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, '--turn-limit', '12', ...dispatchEvidence
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
      '--proposal-id', proposal.id, '--resolution-id', resolution.id, ...dispatchEvidence
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /consumed|single-use/i);

    result = run(process.execPath, [
      dispatch, 'update', '--id', row.id, '--owner-acceptance', 'rejected',
      '--acceptance-proof', 'owner inspection found an incomplete edit',
      '--effective-model', 'reported-parent-model', '--effective-effort', 'high'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rejected = JSON.parse(result.stdout.trim());
    assert.equal(rejected.owner_acceptance.status, 'rejected');
    assert.equal(rejected.owner_acceptance.proof, 'owner inspection found an incomplete edit');
    assert.equal(rejected.effective_model, 'reported-parent-model');
    assert.equal(rejected.routing_match, 'not_applicable');
    result = run(process.execPath, [routing, 'observe', '--dispatch', row.id], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run(process.execPath, [routing, 'observe', '--dispatch', row.id], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already.*observ|duplicate/i);
    result = run(process.execPath, [dispatch, 'list'], repo);
    assert.equal(result.stdout.trim().split('\n').length, 1, 'owner rejection must not automatically redispatch');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('COMPAT-001: legacy dispatch records remain readable with capability-class aliases', async () => {
  const repo = await tempRepo();
  try {
    const dispatch = path.join(root, 'scripts/dispatch-record.mjs');
    let result = run(process.execPath, [dispatch, 'record', '--role', 'scout', '--purpose', 'inventory', '--tier', 'fast'], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /delegation-id|legacy.*read/i);
    result = run(process.execPath, [dispatch, 'init'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster/dispatches/dispatches.jsonl'
    ], repo).stdout.trim();
    await writeFile(runtime, `${JSON.stringify({
      schema_version: 1,
      id: 'legacy-dispatch',
      role: 'scout',
      purpose: 'historical inventory',
      tier: 'fast',
      requested_model: 'fast-default',
      effective_model: 'unverified',
      created_at: '2026-07-30T00:00:00.000Z'
    })}\n`);
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

test('ROUTE-004: per-run configuration is snapshotted and overlays rather than suppresses project mappings', async () => {
  const repo = await tempRepo();
  try {
    const delegation = path.join(root, 'scripts/delegation-record.mjs');
    const routing = path.join(root, 'scripts/model-routing.mjs');
    let result = run(process.execPath, [
      delegation, 'decide', '--selected', 'true',
      '--reason', 'bounded read-only inventory', '--inline-assessment', 'isolation improves reviewability',
      '--role', 'scout', '--ownership', 'src', '--tool-restrictions', 'no_write,no_nested_agents',
      '--dependency-cone', 'src', '--stop-condition', 'inventory returned',
      '--acceptance-proof', 'owner inspects inventory'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout);
    const runtime = run('git', [
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
    ], repo).stdout.trim();
    await writeFile(path.join(runtime, 'config.json'), JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'inherit', policy: 'balanced',
        mappings: { economy: [{
          model: 'project-model', effort: 'low', cost_rank: 1,
          availability: 'declared_available', availability_source: 'project owner'
        }] }
      }
    }));
    const runConfig = path.join(repo, 'run-config.json');
    await writeFile(runConfig, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'cost_optimized',
        mappings: { expert: [{
          model: 'run-expert', effort: 'high',
          availability: 'declared_available', availability_source: 'run owner'
        }] }
      }
    }));
    result = run(process.execPath, [
      routing, 'propose', '--phase', 'dispatch', '--delegation-id', decision.id,
      '--capability-class', 'economy', '--reasoning-effort', 'low',
      '--task-signature', '{"role":"scout","risk":"standard"}',
      '--harness', 'codex', '--harness-version', '0.146.0', '--config', runConfig,
      '--session-id', 'session-2'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proposal = JSON.parse(result.stdout);
    assert.equal(proposal.mode, 'map_only');
    assert.equal(proposal.concrete_model, 'project-model');
    const snapshot = JSON.parse(await readFile(path.join(runtime, 'routing/run-config.json'), 'utf8'));
    assert.equal(snapshot.routing.mode, 'map_only');

    result = run(process.execPath, [
      routing, 'resolve', '--proposal-id', proposal.id,
      '--task-signature', '{"role":"scout","risk":"standard"}',
      '--harness', 'codex', '--harness-version', '0.146.0',
      '--capability-digest', 'unverified', '--catalog-digest', 'unverified',
      '--session-id', 'session-2'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resolution = JSON.parse(result.stdout);
    assert.equal(resolution.requested_model, 'project-model');
    assert.equal(resolution.mapping_source, 'git_local_project');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
