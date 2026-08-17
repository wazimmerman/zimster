import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd, encoding: 'utf8'
  });
}

test('context index supports four evidence states and human-gated promotion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-context-'));
  const file = path.join(directory, 'context-index.json');
  try {
    let result = run('context-index.mjs', ['init', '--file', file], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const state of ['current_truth', 'proposed_delta', 'accepted_decision', 'unresolved_proposal']) {
      result = run('context-index.mjs', [
        'add', '--file', file, '--id', `item-${state}`, '--state', state,
        '--summary', `example ${state}`, '--source', 'test fixture'
      ], directory);
      if (state === 'accepted_decision') assert.notEqual(result.status, 0);
      else assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    result = run('context-index.mjs', [
      'promote', '--file', file, '--id', 'item-proposed_delta', '--approved-by', 'agent:auto'
    ], directory);
    assert.notEqual(result.status, 0);
    result = run('context-index.mjs', [
      'promote', '--file', file, '--id', 'item-proposed_delta', '--approved-by', 'human:owner'
    ], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const index = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(index.schema_version, 1);
    assert.equal(index.entries.find(({ id }) => id === 'item-proposed_delta').state, 'accepted_decision');

    await writeFile(file, `${JSON.stringify({
      schema_version: 1,
      entries: [{
        id: 'forged-decision', state: 'accepted_decision',
        summary: 'approval fields omitted', source: 'external fixture'
      }]
    })}\n`);
    result = run('context-index.mjs', ['list', '--file', file], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /accepted_decision.*approved_by.*approved_at/i);

    await writeFile(file, `${JSON.stringify({
      schema_version: 1,
      entries: [{
        id: 'invented-state', state: 'fifth_state',
        summary: 'outside the four-state contract', source: 'external fixture'
      }]
    })}\n`);
    result = run('context-index.mjs', ['list', '--file', file], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported context state.*fifth_state/i);

    await writeFile(file, `${JSON.stringify({
      schema_version: 1,
      entries: [{ id: 'malformed', state: 'current_truth', source: 'external fixture', extra: true }]
    })}\n`);
    result = run('context-index.mjs', ['list', '--file', file], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /valid id, summary, and source|unsupported context field/i);

    await writeFile(file, `${JSON.stringify({
      schema_version: 1,
      entries: [{
        id: 'bad-date', state: 'accepted_decision', summary: 'noncanonical approval time',
        source: 'external fixture', approved_by: 'human:owner', approved_at: '1'
      }]
    })}\n`);
    result = run('context-index.mjs', ['list', '--file', file], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approved_at.*date-time/i);

    for (const [approvedAt, accepted] of [
      ['2026-02-31T00:00:00Z', false],
      ['2024-02-29T00:00:00Z', true]
    ]) {
      await writeFile(file, `${JSON.stringify({
        schema_version: 1,
        entries: [{
          id: 'calendar-date', state: 'accepted_decision', summary: 'calendar validation',
          source: 'external fixture', approved_by: 'human:owner', approved_at: approvedAt
        }]
      })}\n`);
      result = run('context-index.mjs', ['list', '--file', file], directory);
      assert.equal(result.status === 0, accepted, result.stderr || result.stdout);
    }

    await writeFile(file, `${JSON.stringify({
      schema_version: 1,
      entries: [
        { id: 'duplicate', state: 'current_truth', summary: 'first', source: 'external fixture' },
        { id: 'duplicate', state: 'proposed_delta', summary: 'second', source: 'external fixture' }
      ]
    })}\n`);
    result = run('context-index.mjs', ['list', '--file', file], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate context entry id.*duplicate/i);

    const schema = JSON.parse(await readFile(path.join(root, 'schemas/context-index.schema.json'), 'utf8'));
    assert.ok(schema.properties.entries.items.allOf, 'schema must condition accepted decisions on approval fields');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('run initializer creates canonical journal v3 with plan, decisions, slices, evidence, and risks', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-journal-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'base'], { cwd: repo }).status, 0);
    const result = run('init-run.mjs', [
      '--profile', 'standard', '--plan-id', 'plan-007', '--plan-source', 'approved plan'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtime = path.dirname(result.stdout.trim());
    const journal = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    assert.equal(journal.schema_version, 3);
    assert.deepEqual(journal.plan, { id: 'plan-007', source: 'approved plan' });
    for (const field of ['decisions', 'slice_commits', 'evidence', 'verifications', 'unresolved_risks']) {
      assert.deepEqual(journal[field], []);
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('plan conformance detects requirement drift and blocks unverified release claims', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-conformance-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: directory }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: directory }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: directory }).status, 0);
    await writeFile(path.join(directory, 'tracked.txt'), 'base\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: directory }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'base'], { cwd: directory }).status, 0);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: directory, encoding: 'utf8' }).stdout.trim();
    const plan = path.join(directory, '.git', 'zimster', 'plan');
    await mkdir(plan, { recursive: true });
    const requirements = path.join(plan, 'requirements.json');
    const matrix = path.join(plan, 'matrix.json');
    await writeFile(requirements, `${JSON.stringify({
      schema_version: 1,
      source: 'approved-plan',
      requirements: [{ id: 'PLAN-001', text: 'Ship the portable contract.' }]
    })}\n`);
    const row = {
      id: 'PLAN-001', authoritative_text: 'Ship the portable contract.', source: 'approved-plan',
      implementation_locations: ['plugin.json'], evidence_refs: [],
      evidence_scope: { git_tree: tree, environment: 'node' }, unavailable_proof: [],
      status: 'unverified', intended_acceptance_claims: ['Portable contract ships.'],
      tdd_evidence: 'not_claimed'
    };
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: '0'.repeat(40), candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    let result = run('plan-conformance.mjs', ['--phase', 'slice'], directory);
    assert.notEqual(result.status, 0);
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'slice'], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: ['narrative history is not evidence']
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'slice'], directory);
    assert.notEqual(result.status, 0);
    row.status = 'pending';
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'slice'], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    row.status = 'invented_state';
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'slice'], directory);
    assert.notEqual(result.status, 0);
    row.status = 'unverified';
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'release'], directory);
    assert.notEqual(result.status, 0);
    row.status = 'partially_verified';
    row.evidence_refs = ['prepublication-receipt'];
    row.proof_deferred_until = 'postpublication';
    row.unavailable_proof = ['Registry and release observations do not exist before publication.'];
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'release'], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    delete row.proof_deferred_until;
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'release'], directory);
    assert.notEqual(result.status, 0);
    row.status = 'verified';
    row.evidence_refs = ['receipt-1'];
    row.unavailable_proof = [];
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'release'], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    row.evidence_scope.git_tree = 'candidate';
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: head, candidate_tree: tree,
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', ['--phase', 'release'], directory);
    assert.notEqual(result.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
