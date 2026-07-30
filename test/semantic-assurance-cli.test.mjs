import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/semantic-assurance.mjs'),
    ...args
  ], { cwd, encoding: 'utf8' });
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

test('completion CLI gates candidate state on matrix proof and semantic review', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-completion-cli-'));
  try {
    const repo = path.join(directory, 'repo');
    await mkdir(repo);
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'candidate'], { cwd: repo }).status, 0);
    const candidateHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8'
    }).stdout.trim();
    const candidateTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repo,
      encoding: 'utf8'
    }).stdout.trim();
    const requirementsPath = path.join(directory, 'requirements.json');
    const matrixPath = path.join(directory, 'matrix.json');
    const evidencePath = path.join(directory, 'receipts.jsonl');
    const reviewsPath = path.join(directory, 'reviews.json');
    await writeFile(requirementsPath, JSON.stringify({
      schema_version: 1,
      requirements: [{ id: 'GATE-001', text: 'Gate candidate completion.' }]
    }));
    await writeFile(matrixPath, JSON.stringify({
      schema_version: 1,
      candidate_head: candidateHead,
      candidate_tree: candidateTree,
      requirements: [{
        id: 'GATE-001',
        authoritative_text: 'Gate candidate completion.',
        source: 'plan.md#gate-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: ['receipt-1'],
        evidence_scope: { git_tree: 'candidate', environment: 'node-linux' },
        unavailable_proof: [],
        status: 'verified',
        intended_acceptance_claims: ['Candidate completion is gated.']
      }],
      observations: []
    }));
    await writeFile(evidencePath, `${JSON.stringify({
      schema_version: 2,
      id: 'receipt-1',
      exit_code: 0,
      git_commit: candidateHead,
      git_tree: candidateTree,
      dirty_tree_fingerprint: CLEAN_FINGERPRINT,
      requirement_ids: ['GATE-001'],
      establishes: ['Candidate completion is gated.'],
      does_not_establish: [],
      environment_scope: 'node-linux'
    })}\n`);
    await writeFile(reviewsPath, JSON.stringify({
      schema_version: 1,
      reviews: [{
        schema_version: 1,
        id: 'review-001',
        review_type: 'independent_review',
        owner_inline: false,
        base_sha: 'a'.repeat(40),
        head_sha: candidateHead,
        reviewer_identity: 'reviewer-1',
        dispatch_record_id: null,
        clean_bounded_context: true,
        reviewed_requirement_ids: ['GATE-001'],
        intended_claims: ['Candidate completion is gated.'],
        semantic_lenses: ['mission-scope'],
        review_scope: 'integration',
        verdict: 'approved',
        findings: [],
        unverified_obligations: [],
        reviewed_at: '2026-07-30T12:00:00.000Z',
        review_package_id: 'package-001',
        checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED'
      }]
    }));

    let result = run([
      'complete',
      '--profile', 'standard',
      '--owner-verified',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath,
      '--reviews', reviewsPath
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.state, 'CANDIDATE_COMPLETE');
    assert.deepEqual(decision.allowed_claims, ['Candidate completion is gated.']);
    assert.match(result.stderr, /CANDIDATE_COMPLETE.*review=review-001/i);

    await writeFile(path.join(repo, 'tracked.txt'), 'corrected\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'correction'], { cwd: repo }).status, 0);
    result = run([
      'complete',
      '--profile', 'standard',
      '--owner-verified',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath,
      '--reviews', reviewsPath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const staleDecision = JSON.parse(result.stdout);
    assert.equal(staleDecision.state, 'BLOCKED_BY_MISSING_EVIDENCE');
    assert.match(staleDecision.reasons.join('\n'), /candidate head/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
