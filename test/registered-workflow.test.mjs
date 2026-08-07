import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('run initializer creates journal v2 with plan, decisions, slices, evidence, and risks', async () => {
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
    assert.equal(journal.schema_version, 2);
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
  const requirements = path.join(directory, 'requirements.json');
  const matrix = path.join(directory, 'matrix.json');
  try {
    await writeFile(requirements, `${JSON.stringify({
      schema_version: 1,
      source: 'approved-plan',
      requirements: [{ id: 'PLAN-001', text: 'Ship the portable contract.' }]
    })}\n`);
    const row = {
      id: 'PLAN-001', authoritative_text: 'Ship the portable contract.', source: 'approved-plan',
      implementation_locations: ['plugin.json'], evidence_refs: [],
      evidence_scope: { git_tree: 'candidate', environment: 'node' }, unavailable_proof: [],
      status: 'unverified', intended_acceptance_claims: ['Portable contract ships.']
    };
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: '0'.repeat(40), candidate_tree: '1'.repeat(40),
      requirements: [row], observations: []
    })}\n`);
    let result = run('plan-conformance.mjs', [
      '--phase', 'slice', '--requirements', requirements, '--matrix', matrix
    ], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run('plan-conformance.mjs', [
      '--phase', 'release', '--requirements', requirements, '--matrix', matrix
    ], directory);
    assert.notEqual(result.status, 0);
    row.status = 'verified';
    row.evidence_refs = ['receipt-1'];
    await writeFile(matrix, `${JSON.stringify({
      schema_version: 1, candidate_head: '0'.repeat(40), candidate_tree: '1'.repeat(40),
      requirements: [row], observations: []
    })}\n`);
    result = run('plan-conformance.mjs', [
      '--phase', 'release', '--requirements', requirements, '--matrix', matrix
    ], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
