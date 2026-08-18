import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import {
  decodeEmbeddedReleaseInputs,
  MAX_EMBEDDED_INPUT_BYTES,
  parseReleaseEvidenceRefContents,
  parseReleaseEvidenceTagPayload,
  validateEmbeddedPublicReleaseInputs,
  validatePublicReleaseInput
} from '../scripts/lib/release-evidence.mjs';
import { root } from './helpers.mjs';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/release-evidence.mjs'), ...args], {
    cwd, encoding: 'utf8'
  });
}

function releaseInputs(commit, tree) {
  return {
    semantic: {
      schema_version: 1,
      id: 'final-review', review_type: 'independent_review', owner_inline: false,
      base_sha: 'a'.repeat(40), head_sha: commit, candidate_tree: tree,
      seam_id: 'release-seam', review_attempt_id: 'release-seam:final:1',
      reviewer_identity: 'reviewer-1', dispatch_record_id: null,
      reviewer_provenance: 'not_host_authenticated', clean_bounded_context: true,
      reviewed_requirement_ids: ['RELEASE-001'], intended_claims: ['Release candidate is bounded.'],
      semantic_lenses: ['release-integrity'], review_scope: 'integration', verdict: 'approved',
      findings: [], unverified_obligations: [], reviewed_at: '2026-08-18T00:00:00.000Z',
      review_package_id: 'package-final', requirement_matrix_sha256: 'b'.repeat(64),
      semantic_contract_sha256: 'c'.repeat(64), checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED'
    },
    matrix: {
      schema_version: 1, candidate_commit: commit, candidate_tree: tree,
      hosts: [{
        host: 'codex', artifact_sha256: 'd'.repeat(64), host_version: '1.0.0',
        tested_at: '2026-08-18T00:00:00.000Z', verification_level: 'structural',
        capabilities_established: ['skill discovery'], capabilities_not_established: ['model-backed execution'],
        known_limitations: ['No authenticated model session.']
      }]
    },
    verification: {
      schema_version: 1, candidate_commit: commit, candidate_tree: tree, status: 'passed',
      steps: [{ id: 'release-gate', status: 'passed', log_id: 'release-gate', log_sha256: 'e'.repeat(64) }],
      release_review_authorization: {
        state: 'HUMAN_RELEASE_REVIEW_ACCEPTED', review_id: 'final-review',
        reviewer_provenance: 'not_host_authenticated', candidate_base: 'a'.repeat(40),
        candidate_head: commit, candidate_tree: tree, review_package_id: 'package-final',
        requirement_matrix_sha256: 'b'.repeat(64), semantic_contract_sha256: 'c'.repeat(64),
        required_lenses: ['release-integrity']
      }
    }
  };
}

test('signed authorization accepts exactly one canonical JSON payload', () => {
  const payload = { schema_version: 1, version: '0.7.0' };
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  assert.deepEqual(parseReleaseEvidenceTagPayload(canonical), payload);
  assert.deepEqual(parseReleaseEvidenceRefContents(`${canonical}\n`), payload);
  for (const invalid of [
    `release approved\n${canonical}`,
    `${canonical}additional note\n`,
    `${JSON.stringify(payload)}\n`
  ]) {
    assert.throws(() => parseReleaseEvidenceTagPayload(invalid), /canonical.*payload/i);
  }
  assert.throws(
    () => parseReleaseEvidenceRefContents(`release approved\n${canonical}\n`),
    /canonical.*payload/i
  );
});

test('release evidence canonically binds authorization inputs and all five artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-release-evidence-'));
  try {
    const dist = path.join(directory, 'dist');
    await createPackages(dist);
    const semantic = path.join(directory, 'semantic.json');
    const matrix = path.join(directory, 'hosts.json');
    const verification = path.join(directory, 'verification.json');
    const output = path.join(directory, 'release-evidence.json');
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const inputs = releaseInputs(commit, tree);
    await writeFile(semantic, `${JSON.stringify(inputs.semantic)}\n`);
    await writeFile(matrix, `${JSON.stringify(inputs.matrix)}\n`);
    await writeFile(verification, `${JSON.stringify(inputs.verification)}\n`);
    let result = run([
      'create', '--version', '0.7.2', '--tag', 'v0.7.2', '--channel', 'public_beta',
      '--commit', commit, '--tree', tree, '--standards-lock', 'config/standards-lock.json',
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--dist', dist, '--output', output
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(evidence.schema_version, 2);
    assert.equal(evidence.commit, commit);
    assert.equal(evidence.tree, tree);
    assert.deepEqual(evidence.artifacts.map(({ name }) => name), [
      'zimster-0.7.2-claude.zip', 'zimster-0.7.2-codex.zip',
      'zimster-0.7.2-openai.zip', 'zimster-0.7.2-portable.zip', 'zimster-0.7.2.tgz'
    ]);
    assert.deepEqual(Object.keys(evidence.embedded_inputs), [
      'semantic-review.json', 'host-matrix.json', 'verification.json'
    ]);
    const embedded = decodeEmbeddedReleaseInputs(evidence);
    assert.deepEqual(JSON.parse(embedded.get('semantic-review.json')), inputs.semantic);
    assert.deepEqual(JSON.parse(embedded.get('host-matrix.json')), inputs.matrix);
    assert.deepEqual(JSON.parse(embedded.get('verification.json')), inputs.verification);
    result = run([
      'verify', '--file', output, '--expected-tag', 'v0.7.2', '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', 'config/standards-lock.json',
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--dist', dist
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const [file, original, label] of [
      [semantic, `${JSON.stringify(inputs.semantic)}\n`, 'semantic review'],
      [matrix, `${JSON.stringify(inputs.matrix)}\n`, 'host matrix'],
      [verification, `${JSON.stringify(inputs.verification)}\n`, 'verification']
    ]) {
      await writeFile(file, `${original.trim()} `);
      result = run([
        'verify', '--file', output, '--expected-tag', 'v0.7.2', '--expected-commit', commit,
        '--expected-tree', tree, '--standards-lock', 'config/standards-lock.json',
        '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
        '--dist', dist
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`${label}.*digest`, 'i'));
      await writeFile(file, original);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public release inputs reject machine-local paths and secrets on every platform', () => {
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const inputs = releaseInputs(commit, tree);
  for (const [label, unsafe] of [
    ['Linux HOME', '/home/alice/project/.git/zimster/verification.json'],
    ['macOS HOME', '/Users/alice/Library/Caches/zimster.log'],
    ['Windows profile', 'C:\\Users\\Alice\\AppData\\Local\\Temp\\zimster.log'],
    ['Git-local runtime', '.git/zimster/reviews/lifecycle.json'],
    ['private key', ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')],
    ['GitHub token', `ghp_${'A'.repeat(32)}`],
    ['npm token', `npm_${'A'.repeat(36)}`]
  ]) {
    const document = structuredClone(inputs.verification);
    document.steps[0].log_id = unsafe;
    assert.throws(() => validatePublicReleaseInput(
      'verification.json', Buffer.from(`${JSON.stringify(document)}\n`),
      { candidateCommit: commit, candidateTree: tree }
    ), new RegExp(`unsafe|secret|path`, 'i'), label);
  }
});

test('signed release inputs use the canonical exact review authorization contract', () => {
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const original = releaseInputs(commit, tree);
  const encodedEvidence = (inputs) => {
    const rows = [
      ['semantic-review.json', 'semantic_review_sha256', inputs.semantic],
      ['host-matrix.json', 'host_matrix_sha256', inputs.matrix],
      ['verification.json', 'verification_sha256', inputs.verification]
    ];
    const evidence = {
      schema_version: 2, commit, tree, embedded_inputs: {}
    };
    for (const [name, digestField, document] of rows) {
      const bytes = Buffer.from(`${JSON.stringify(document)}\n`);
      evidence[digestField] = createHash('sha256').update(bytes).digest('hex');
      evidence.embedded_inputs[name] = bytes.toString('base64');
    }
    return evidence;
  };
  assert.doesNotThrow(() => validateEmbeddedPublicReleaseInputs(encodedEvidence(original)));

  for (const [label, mutate] of [
    ['independent review', (input) => { input.semantic.review_type = 'self_review'; }],
    ['integration scope', (input) => { input.semantic.review_scope = 'seam'; }],
    ['owner inline review', (input) => { input.semantic.owner_inline = true; input.semantic.review_type = 'self_review'; }],
    ['reviewer provenance', (input) => { input.verification.release_review_authorization.reviewer_provenance = 'host_authenticated'; }],
    ['review id', (input) => { input.verification.release_review_authorization.review_id = 'wrong-review'; }],
    ['bounded context', (input) => { input.semantic.clean_bounded_context = false; }],
    ['changed checkout', (input) => { input.semantic.checkout_integrity_result = 'REVIEW_CHECKOUT_CHANGED'; }],
    ['unverified checkout', (input) => { input.semantic.checkout_integrity_result = 'REVIEW_CHECKOUT_UNVERIFIED'; }],
    ['base', (input) => { input.semantic.base_sha = 'c'.repeat(40); }],
    ['head', (input) => { input.semantic.head_sha = 'c'.repeat(40); }],
    ['tree', (input) => { input.semantic.candidate_tree = 'c'.repeat(40); }],
    ['package', (input) => { input.semantic.review_package_id = 'wrong-package'; }],
    ['matrix digest', (input) => { input.semantic.requirement_matrix_sha256 = 'd'.repeat(64); }],
    ['contract digest', (input) => { input.semantic.semantic_contract_sha256 = 'd'.repeat(64); }],
    ['required lens', (input) => { input.semantic.semantic_lenses = []; }],
    ['Critical finding', (input) => { input.semantic.findings = [{ severity: 'Critical', summary: 'blocker' }]; input.semantic.verdict = 'needs_correction'; }],
    ['Important finding', (input) => { input.semantic.findings = [{ severity: 'Important', summary: 'blocker' }]; input.semantic.verdict = 'needs_correction'; }],
    ['obligation', (input) => { input.semantic.unverified_obligations = ['missing']; input.semantic.verdict = 'blocked_by_missing_evidence'; }],
    ['verdict', (input) => { input.semantic.verdict = 'needs_correction'; }]
  ]) {
    const mutated = structuredClone(original);
    mutate(mutated);
    assert.throws(
      () => validateEmbeddedPublicReleaseInputs(encodedEvidence(mutated)),
      /release review|authorization|checkout|base|head|tree|package|matrix|contract|lens|finding|obligation|approved/i,
      label
    );
  }
});

test('embedded release inputs reject missing, extra, noncanonical, and oversized data', () => {
  const bytes = Buffer.from('{"status":"passed"}\n');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const evidence = {
    schema_version: 2,
    semantic_review_sha256: digest,
    host_matrix_sha256: digest,
    verification_sha256: digest,
    embedded_inputs: {
      'semantic-review.json': bytes.toString('base64'),
      'host-matrix.json': bytes.toString('base64'),
      'verification.json': bytes.toString('base64')
    }
  };
  assert.equal(decodeEmbeddedReleaseInputs(evidence).size, 3);

  for (const name of Object.keys(evidence.embedded_inputs)) {
    const modified = structuredClone(evidence);
    modified.embedded_inputs[name] = Buffer.from('{"status":"modified"}\n').toString('base64');
    assert.throws(() => decodeEmbeddedReleaseInputs(modified), /bytes do not match.*sha256/i);
  }

  const missing = structuredClone(evidence);
  delete missing.embedded_inputs['host-matrix.json'];
  assert.throws(() => decodeEmbeddedReleaseInputs(missing), /exactly.*three|inventory/i);

  const extra = structuredClone(evidence);
  extra.embedded_inputs['postmortem.json'] = bytes.toString('base64');
  assert.throws(() => decodeEmbeddedReleaseInputs(extra), /exactly.*three|inventory/i);

  const noncanonical = structuredClone(evidence);
  noncanonical.embedded_inputs['verification.json'] = `${bytes.toString('base64')}\n`;
  assert.throws(() => decodeEmbeddedReleaseInputs(noncanonical), /canonical.*base64/i);

  const oversized = structuredClone(evidence);
  oversized.embedded_inputs['semantic-review.json'] = Buffer.alloc(
    MAX_EMBEDDED_INPUT_BYTES + 1, 0x61
  ).toString('base64');
  assert.throws(() => decodeEmbeddedReleaseInputs(oversized), /size limit/i);

  const oversizedTag = `${JSON.stringify({ data: 'a'.repeat(4 * 1024 * 1024) }, null, 2)}\n`;
  assert.throws(() => parseReleaseEvidenceTagPayload(oversizedTag), /tag payload.*size limit/i);
});

test('v0.6.0 baseline records the true immutable release object and rejects local archive provenance', async () => {
  const baseline = JSON.parse(await readFile(path.join(root, 'release/baselines/v0.6.0.json'), 'utf8'));
  assert.equal(baseline.tag, 'v0.6.0');
  assert.equal(baseline.commit, '9b128196dc058d92117edeaf0dcd670e946f67db');
  assert.equal(baseline.tree, 'c5cebddf1426ba8d488e5c4cc9f053823ad9483d');
  assert.equal(baseline.local_archives_trusted, false);
});
