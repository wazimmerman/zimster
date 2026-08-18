import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function commit(repo, message) {
  assert.equal(run('git', ['add', '.'], repo).status, 0);
  assert.equal(run('git', ['commit', '-m', message], repo).status, 0);
  return run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
}

test('review package keeps authoritative changes and hashes generated mirrors without duplication', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-package-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-requirements-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await mkdir(path.join(repo, 'scripts'), { recursive: true });
    await mkdir(path.join(repo, 'plugins/zimster/scripts'), { recursive: true });
    await writeFile(path.join(repo, 'scripts/example.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(repo, 'plugins/zimster/scripts/example.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(repo, 'interface.json'), '{"schema_version":1}\n');
    const base = await commit(repo, 'base');

    await writeFile(path.join(repo, 'scripts/example.mjs'), 'export const value = 2;\n');
    await writeFile(path.join(repo, 'plugins/zimster/scripts/example.mjs'), 'export const value = 2;\n');
    const head = await commit(repo, 'change');

    const evidence = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'record',
      '--kind', 'test', '--scope', 'affected', '--command', 'node --test',
      '--exit-code', '0', '--tests-passed', '1', '--tests-failed', '0',
      '--dependencies', 'scripts/example.mjs'
    ], repo);
    assert.equal(evidence.status, 0, evidence.stderr || evidence.stdout);
    const receipt = JSON.parse(evidence.stdout);
    const ledger = path.join(repo, '.git', 'zimster', 'evidence', 'receipts.jsonl');
    for (let index = 0; index < 21; index += 1) {
      await appendFile(ledger, `${JSON.stringify({
        schema_version: 2,
        id: `filler-${index}`,
        kind: 'test',
        scope: 'focused',
        exit_code: 0
      })}\n`);
    }
    const requirements = path.join(external, 'requirements.md');
    const bindingRequirements = path.join(external, 'binding-requirements.json');
    const matrix = path.join(external, 'requirement-matrix.json');
    await writeFile(requirements, '# Mission\n\nKeep review packages compact.\n');
    await writeFile(bindingRequirements, JSON.stringify({
      schema_version: 1,
      source: 'requirements.md',
      requirements: [{
        id: 'REVIEW-001',
        text: 'Review packages include semantic assurance inputs.'
      }]
    }));
    await writeFile(matrix, JSON.stringify({
      schema_version: 1,
      candidate_head: head,
      candidate_tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
      requirements: [{
        id: 'REVIEW-001',
        authoritative_text: 'Review packages include semantic assurance inputs.',
        source: 'requirements.md#review-001',
        implementation_locations: ['scripts/example.mjs'],
        evidence_refs: [receipt.id],
        evidence_scope: {
          git_tree: run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim(),
          environment: 'node-linux'
        },
        unavailable_proof: ['Independent review pending.'],
        status: 'partially_verified',
        intended_acceptance_claims: ['Semantic review inputs are complete.']
      }],
      observations: []
    }));

    const result = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', base,
      '--head', head,
      '--requirements', requirements,
      '--binding-requirements', bindingRequirements,
      '--matrix', matrix,
      '--interfaces', 'interface.json',
      '--lenses', 'mission,state-authority',
      '--risk-signals', 'build-tool,shared-adapter-control-flow',
      '--intended-claims', JSON.stringify(['Semantic review inputs are complete.']),
      '--unavailable-proof', JSON.stringify(['Independent review pending.']),
      '--requested-state', 'CANDIDATE_COMPLETE'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.length < 2000);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'created');
    assert.equal(summary.base, base);
    assert.equal(summary.head, head);

    const review = JSON.parse(await readFile(summary.package, 'utf8'));
    assert.deepEqual(review.authoritative_changed_files.map(({ path: file }) => file), [
      'scripts/example.mjs'
    ]);
    assert.deepEqual(review.generated_mirrors.map(({ path: file }) => file), [
      'plugins/zimster/scripts/example.mjs'
    ]);
    assert.equal(review.generated_mirrors[0].canonical_path, 'scripts/example.mjs');
    assert.equal(review.generated_mirrors[0].synchronized, true);
    assert.equal(Object.hasOwn(review.generated_mirrors[0], 'content'), false);
    assert.deepEqual(review.relevant_unchanged_interfaces.map(({ path: file }) => file), [
      'interface.json'
    ]);
    assert.deepEqual(review.lenses, [
      'mission',
      'state-authority',
      'framework-defaults-and-conventions',
      'shared-control-flow'
    ]);
    assert.deepEqual(review.binding_requirements.requirement_ids, ['REVIEW-001']);
    assert.equal(review.requirement_matrix.candidate_head, head);
    assert.match(review.semantic_contract.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(review.intended_acceptance_claims, [
      'Semantic review inputs are complete.'
    ]);
    assert.deepEqual(review.unavailable_proof, ['Independent review pending.']);
    assert.equal(review.requested_completion_state, 'CANDIDATE_COMPLETE');
    assert.equal(review.evidence.some(({ id }) => id === receipt.id), true);
    const summarizedReceipt = review.evidence.find(({ id }) => id === receipt.id);
    assert.equal(
      summarizedReceipt.git_tree,
      run('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim()
    );
    assert.match(summarizedReceipt.dirty_tree_fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(summarizedReceipt.dependency_freshness, {
      status: 'fresh',
      reason: null
    });
    const diff = await readFile(review.authoritative_diff, 'utf8');
    assert.match(diff, /scripts\/example\.mjs/);
    assert.doesNotMatch(diff, /plugins\/zimster/);

    const invalidation = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'), 'invalidate',
      '--id', receipt.id,
      '--reason', 'review correction changed the proof state'
    ], repo);
    assert.equal(invalidation.status, 0, invalidation.stderr || invalidation.stdout);
    const corrected = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', base,
      '--head', head,
      '--requirements', requirements,
      '--binding-requirements', bindingRequirements,
      '--matrix', matrix,
      '--interfaces', 'interface.json',
      '--lenses', 'mission,state-authority',
      '--risk-signals', 'build-tool,shared-adapter-control-flow',
      '--intended-claims', JSON.stringify(['Semantic review inputs are complete.']),
      '--unavailable-proof', JSON.stringify(['Independent review pending.']),
      '--requested-state', 'CANDIDATE_COMPLETE'
    ], repo);
    assert.equal(corrected.status, 0, corrected.stderr || corrected.stdout);
    const correctedSummary = JSON.parse(corrected.stdout);
    assert.notEqual(correctedSummary.id, summary.id);
    const correctedPackage = JSON.parse(await readFile(correctedSummary.package, 'utf8'));
    assert.equal(
      correctedPackage.evidence.find(({ id }) => id === receipt.id).status,
      'stale'
    );
    assert.equal(
      correctedPackage.semantic_contract.sha256,
      review.semantic_contract.sha256
    );

    const changedMatrix = JSON.parse(await readFile(matrix, 'utf8'));
    changedMatrix.requirements[0].intended_acceptance_claims = [
      'A changed semantic acceptance claim.'
    ];
    changedMatrix.requirements[0].implementation_locations = [
      'scripts/different-contract.mjs'
    ];
    await writeFile(matrix, JSON.stringify(changedMatrix));
    const changedContract = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', base,
      '--head', head,
      '--requirements', requirements,
      '--binding-requirements', bindingRequirements,
      '--matrix', matrix,
      '--interfaces', 'interface.json',
      '--lenses', 'mission,state-authority',
      '--risk-signals', 'build-tool,shared-adapter-control-flow',
      '--intended-claims', JSON.stringify(['A changed semantic acceptance claim.']),
      '--unavailable-proof', JSON.stringify(['Independent review pending.']),
      '--requested-state', 'CANDIDATE_COMPLETE'
    ], repo);
    assert.equal(changedContract.status, 0, changedContract.stderr || changedContract.stdout);
    const changedContractPackage = JSON.parse(
      await readFile(JSON.parse(changedContract.stdout).package, 'utf8')
    );
    assert.notEqual(
      changedContractPackage.semantic_contract.sha256,
      review.semantic_contract.sha256
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('review package rejects mutable base or head references', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-sha-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await commit(repo, 'base');
    const result = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'),
      '--base', 'main', '--head', 'HEAD'
    ], repo);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /immutable|40-character|sha/i);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('review package fingerprints dirty tracked and untracked in-progress work', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-review-dirty-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    const base = await commit(repo, 'base');
    await writeFile(path.join(repo, 'tracked.txt'), 'dirty tracked\n');
    await writeFile(path.join(repo, 'untracked.txt'), 'dirty untracked\n');

    const first = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'), '--base', base, '--head', base
    ], repo);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstSummary = JSON.parse(first.stdout);
    const firstPackage = JSON.parse(await readFile(firstSummary.package, 'utf8'));
    assert.match(firstPackage.dirty_state.dirty_tree_fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(firstPackage.dirty_state.touched_files, ['tracked.txt', 'untracked.txt']);
    assert.equal(firstPackage.dirty_state.untracked[0].mode, '100644');
    assert.match(await readFile(firstPackage.dirty_state.tracked_diff, 'utf8'), /dirty tracked/);
    const untracked = JSON.parse(await readFile(firstPackage.dirty_state.untracked_payload, 'utf8'));
    assert.equal(Buffer.from(untracked[0].data_base64, 'base64').toString(), 'dirty untracked\n');

    await writeFile(path.join(repo, 'untracked.txt'), 'changed untracked\n');
    const second = run(process.execPath, [
      path.join(root, 'scripts/review-package.mjs'), '--base', base, '--head', base
    ], repo);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.notEqual(JSON.parse(second.stdout).id, firstSummary.id);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
