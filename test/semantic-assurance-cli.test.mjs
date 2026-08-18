import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function semanticContractSha256(bindingRequirements, matrix) {
  const byId = (left, right) => left.id.localeCompare(right.id);
  return createHash('sha256').update(JSON.stringify({
    schema_version: 1,
    binding_requirements: bindingRequirements.requirements
      .map(({ id, text }) => ({ id, text }))
      .sort(byId),
    requirements: matrix.requirements.map((entry) => ({
      id: entry.id,
      authoritative_text: entry.authoritative_text,
      source: entry.source,
      implementation_locations: [...entry.implementation_locations].sort(),
      evidence_scope: {
        git_tree: entry.evidence_scope?.git_tree || null,
        environment: entry.evidence_scope?.environment || null
      },
      intended_acceptance_claims: [...entry.intended_acceptance_claims].sort()
    })).sort(byId)
  })).digest('hex');
}

function run(args, cwd = root) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/semantic-assurance.mjs'),
    ...args
  ], { cwd, encoding: 'utf8' });
}

test('matrix CLI emits machine-readable coverage and a human summary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-matrix-cli-'));
  try {
    const repo = path.join(directory, 'repo');
    await mkdir(repo);
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
    assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'candidate'], { cwd: repo }).status, 0);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const requirementsPath = path.join(directory, 'requirements.json');
    const matrixPath = path.join(directory, 'matrix.json');
    const evidencePath = path.join(directory, 'receipts.jsonl');
    await writeFile(requirementsPath, JSON.stringify({
      schema_version: 1,
      requirements: [{ id: 'MATRIX-001', text: 'Validate matrix coverage.' }]
    }));
    await writeFile(matrixPath, JSON.stringify({
      schema_version: 1,
      candidate_head: head,
      candidate_tree: tree,
      requirements: [{
        id: 'MATRIX-001',
        authoritative_text: 'Validate matrix coverage.',
        source: 'plan.md#matrix-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: ['receipt-1'],
        evidence_scope: { git_tree: tree, environment: 'node-linux' },
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
      git_commit: head,
      git_tree: tree,
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
    ], repo);
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
    const reviewPackagePath = path.join(directory, 'review-package.json');
    const bindingRequirements = {
      schema_version: 1,
      requirements: [{ id: 'GATE-001', text: 'Gate candidate completion.' }]
    };
    const requirementMatrix = {
      schema_version: 1,
      candidate_head: candidateHead,
      candidate_tree: candidateTree,
      requirements: [{
        id: 'GATE-001',
        authoritative_text: 'Gate candidate completion.',
        source: 'plan.md#gate-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: ['receipt-1'],
        evidence_scope: { git_tree: candidateTree, environment: 'node-linux' },
        unavailable_proof: [],
        status: 'verified',
        intended_acceptance_claims: ['Candidate completion is gated.']
      }],
      observations: []
    };
    await writeFile(requirementsPath, JSON.stringify(bindingRequirements));
    await writeFile(matrixPath, JSON.stringify(requirementMatrix));
    const matrixSha256 = createHash('sha256')
      .update(await import('node:fs/promises').then(({ readFile }) => readFile(matrixPath)))
      .digest('hex');
    const contractSha256 = semanticContractSha256(bindingRequirements, requirementMatrix);
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
        candidate_tree: candidateTree,
        seam_id: 'release-seam',
        review_attempt_id: 'release-seam:final:1',
        reviewer_identity: 'reviewer-1',
        dispatch_record_id: 'dispatch-reviewer-1',
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
        requirement_matrix_sha256: matrixSha256,
        semantic_contract_sha256: contractSha256,
        checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED'
      }]
    }));
    await writeFile(reviewPackagePath, JSON.stringify({
      schema_version: 1,
      id: 'package-001',
      base: 'a'.repeat(40),
      head: candidateHead,
      requirement_matrix: {
        sha256: matrixSha256,
        candidate_head: candidateHead,
        candidate_tree: candidateTree
      },
      semantic_contract: { sha256: contractSha256 },
      lenses: ['mission-scope']
    }));
    const runtime = path.join(repo, '.git', 'zimster');
    await mkdir(path.join(runtime, 'reviews'), { recursive: true });
    await mkdir(path.join(runtime, 'dispatches'), { recursive: true });
    await writeFile(path.join(runtime, 'reviews', 'lifecycle.json'), JSON.stringify({
      schema_version: 2,
      run_id: 'run-cli',
      seam_id: 'release-seam',
      status: 'REVIEW_LIFECYCLE_COMPLETE',
      approved_review: {
        attempt_id: 'release-seam:final:1',
        seam_id: 'release-seam',
        review_record_id: 'review-001',
        reviewer_id: 'reviewer-1',
        dispatch_record_id: 'dispatch-reviewer-1',
        review_package_id: 'package-001',
        candidate_head: candidateHead,
        candidate_tree: candidateTree,
        semantic_contract_sha256: contractSha256,
        verdict: 'approved'
      }
    }));
    await writeFile(path.join(runtime, 'dispatches', 'dispatches.jsonl'), `${JSON.stringify({
      schema_version: 2,
      id: 'dispatch-reviewer-1',
      run_id: 'run-cli',
      role: 'final-integration-reviewer',
      agent_id: 'reviewer-1',
      provenance_kind: 'owner_recorded_dispatch'
    })}\n`);

    let result = run([
      'complete',
      '--profile', 'standard',
      '--owner-verified',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath,
      '--reviews', reviewsPath,
      '--review-package', reviewPackagePath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.state, 'OWNER_VERIFIED_REVIEW_UNAVAILABLE');
    assert.deepEqual(decision.allowed_claims, ['Candidate completion is gated.']);
    assert.match(decision.reasons.join('\n'), /owner-recorded dispatch.*host-observed/i);

    requirementMatrix.observations.push({
      id: 'final-evidence-state',
      status: 'valid',
      requirement_ids: ['GATE-001'],
      establishes: ['Candidate completion is gated.'],
      does_not_establish: [],
      environment_scope: 'node-linux',
      git_commit: candidateHead,
      git_tree: candidateTree,
      dirty_tree_fingerprint: CLEAN_FINGERPRINT
    });
    await writeFile(matrixPath, JSON.stringify(requirementMatrix));
    result = run([
      'complete',
      '--profile', 'standard',
      '--owner-verified',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath,
      '--reviews', reviewsPath,
      '--review-package', reviewPackagePath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).state, 'OWNER_VERIFIED_REVIEW_UNAVAILABLE');

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
      '--reviews', reviewsPath,
      '--review-package', reviewPackagePath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const staleDecision = JSON.parse(result.stdout);
    assert.equal(staleDecision.state, 'BLOCKED_BY_MISSING_EVIDENCE');
    assert.match(staleDecision.reasons.join('\n'), /candidate head/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('completion CLI rejects a review that is not bound to its exact package and semantic contract', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-package-binding-cli-'));
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
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const candidateTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repo, encoding: 'utf8'
    }).stdout.trim();
    const requirementsPath = path.join(directory, 'requirements.json');
    const matrixPath = path.join(directory, 'matrix.json');
    const evidencePath = path.join(directory, 'receipts.jsonl');
    const reviewsPath = path.join(directory, 'reviews.json');
    const packagePath = path.join(directory, 'review-package.json');
    await writeFile(requirementsPath, JSON.stringify({
      schema_version: 1,
      requirements: [{ id: 'GATE-001', text: 'Bind approval to exact inputs.' }]
    }));
    await writeFile(matrixPath, JSON.stringify({
      schema_version: 1,
      candidate_head: candidateHead,
      candidate_tree: candidateTree,
      requirements: [{
        id: 'GATE-001',
        authoritative_text: 'Bind approval to exact inputs.',
        source: 'requirements.md#gate-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: ['receipt-1'],
        evidence_scope: { git_tree: candidateTree, environment: 'node-linux' },
        unavailable_proof: [],
        status: 'verified',
        intended_acceptance_claims: ['Approval is bound to exact inputs.']
      }],
      observations: []
    }));
    const matrixBytes = await import('node:fs/promises').then(({ readFile }) => readFile(matrixPath));
    const matrixSha256 = createHash('sha256').update(matrixBytes).digest('hex');
    const contractSha256 = semanticContractSha256(
      JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(requirementsPath))),
      JSON.parse(matrixBytes)
    );
    await writeFile(evidencePath, `${JSON.stringify({
      schema_version: 2,
      id: 'receipt-1',
      exit_code: 0,
      git_commit: candidateHead,
      git_tree: candidateTree,
      dirty_tree_fingerprint: CLEAN_FINGERPRINT,
      requirement_ids: ['GATE-001'],
      establishes: ['Approval is bound to exact inputs.'],
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
        intended_claims: ['Approval is bound to exact inputs.'],
        semantic_lenses: ['mission-scope'],
        review_scope: 'integration',
        verdict: 'approved',
        findings: [],
        unverified_obligations: [],
        reviewed_at: '2026-07-30T12:00:00.000Z',
        review_package_id: 'stale-package',
        requirement_matrix_sha256: matrixSha256,
        semantic_contract_sha256: contractSha256,
        checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED'
      }]
    }));
    await writeFile(packagePath, JSON.stringify({
      schema_version: 1,
      id: 'current-package',
      base: 'a'.repeat(40),
      head: candidateHead,
      requirement_matrix: { sha256: matrixSha256 },
      semantic_contract: { sha256: contractSha256 },
      lenses: ['mission-scope']
    }));
    const result = run([
      'complete',
      '--profile', 'standard',
      '--owner-verified',
      '--requirements', requirementsPath,
      '--matrix', matrixPath,
      '--evidence', evidencePath,
      '--reviews', reviewsPath,
      '--review-package', packagePath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).reasons.join('\n'), /package/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('matrix CLI marks naturally stale dependency evidence invalid', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-stale-evidence-cli-'));
  try {
    const repo = path.join(directory, 'repo');
    await mkdir(repo);
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
    await writeFile(path.join(repo, 'dependency.txt'), 'original\n');
    assert.equal(spawnSync('git', ['add', 'dependency.txt'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'fixture'], { cwd: repo }).status, 0);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const requirementsPath = path.join(directory, 'requirements.json');
    const matrixPath = path.join(directory, 'matrix.json');
    await writeFile(requirementsPath, JSON.stringify({
      schema_version: 1,
      requirements: [{ id: 'EVIDENCE-001', text: 'Reject stale evidence.' }]
    }));
    const receiptResult = spawnSync(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'),
      'record',
      '--kind', 'test',
      '--scope', 'focused',
      '--command', 'node --test',
      '--exit-code', '0',
      '--tests-passed', '1',
      '--tests-failed', '0',
      '--dependencies', 'dependency.txt',
      '--requirement-ids', 'EVIDENCE-001',
      '--establishes', 'Fresh dependencies are enforced.',
      '--does-not-establish', 'Unrelated behavior is compatible.',
      '--environment-scope', 'node-linux'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(receiptResult.status, 0, receiptResult.stderr || receiptResult.stdout);
    const receipt = JSON.parse(receiptResult.stdout);
    await writeFile(matrixPath, JSON.stringify({
      schema_version: 1,
      candidate_head: head,
      candidate_tree: tree,
      requirements: [{
        id: 'EVIDENCE-001',
        authoritative_text: 'Reject stale evidence.',
        source: 'requirements.md#evidence-001',
        implementation_locations: ['scripts/semantic-assurance.mjs'],
        evidence_refs: [receipt.id],
        evidence_scope: { git_tree: 'any', environment: 'node-linux' },
        unavailable_proof: [],
        status: 'verified',
        intended_acceptance_claims: ['Fresh dependencies are enforced.']
      }],
      observations: []
    }));
    let result = run([
      'matrix',
      '--requirements', requirementsPath,
      '--matrix', matrixPath
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(path.join(repo, 'dependency.txt'), 'changed\n');
    result = run([
      'matrix',
      '--requirements', requirementsPath,
      '--matrix', matrixPath
    ], repo);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).issues.join('\n'), /stale/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
