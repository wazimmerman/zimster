import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function run(args) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/semantic-assurance.mjs'),
    ...args
  ], { cwd: root, encoding: 'utf8' });
}

test('matrix CLI emits machine-readable coverage and a human summary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-matrix-cli-'));
  try {
    const requirementsPath = path.join(directory, 'requirements.json');
    const matrixPath = path.join(directory, 'matrix.json');
    const evidencePath = path.join(directory, 'receipts.jsonl');
    await writeFile(requirementsPath, JSON.stringify({
      schema_version: 1,
      requirements: [{ id: 'MATRIX-001', text: 'Validate matrix coverage.' }]
    }));
    await writeFile(matrixPath, JSON.stringify({
      schema_version: 1,
      candidate_head: HEAD,
      candidate_tree: TREE,
      requirements: [{
        id: 'MATRIX-001',
        authoritative_text: 'Validate matrix coverage.',
        source: 'plan.md#matrix-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: ['receipt-1'],
        evidence_scope: { git_tree: 'candidate', environment: 'node-linux' },
        unavailable_proof: [],
        status: 'verified',
        intended_acceptance_claims: ['Matrix coverage is validated.']
      }],
      observations: []
    }));
    await writeFile(evidencePath, `${JSON.stringify({
      schema_version: 2,
      id: 'receipt-1',
      exit_code: 0,
      git_commit: HEAD,
      git_tree: TREE,
      dirty_tree_fingerprint: CLEAN_FINGERPRINT,
      requirement_ids: ['MATRIX-001'],
      establishes: ['Matrix coverage is validated.'],
      does_not_establish: [],
      environment_scope: 'node-linux'
    })}\n`);

    const result = run([
      'matrix',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.valid, true);
    assert.deepEqual(decision.allowed_claims, ['Matrix coverage is validated.']);
    assert.match(result.stderr, /MATRIX_VALID.*verified=1/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
