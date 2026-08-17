import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import {
  parseReleaseEvidenceRefContents,
  parseReleaseEvidenceTagPayload
} from '../scripts/lib/release-evidence.mjs';
import { root } from './helpers.mjs';
import {
  applyReviewLifecycleEvent,
  createReviewLifecycle
} from '../scripts/lib/review-lifecycle.mjs';

const CLEAN = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/release-evidence.mjs'), ...args], {
    cwd, encoding: 'utf8'
  });
}

async function coherentReleaseRepo(directory) {
  const repo = path.join(directory, 'repo');
  await mkdir(repo);
  assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: repo }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.name', 'Zimster Test'], { cwd: repo }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo }).status, 0);
  await writeFile(path.join(repo, 'tracked.txt'), 'candidate\n');
  assert.equal(spawnSync('git', ['add', 'tracked.txt'], { cwd: repo }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-m', 'candidate'], { cwd: repo }).status, 0);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  let result = spawnSync(process.execPath, [
    path.join(root, 'scripts/init-run.mjs'),
    '--profile', 'high-risk', '--reason', 'release evidence fixture'
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync(process.execPath, [
    path.join(root, 'scripts/run-control.mjs'), 'start',
    '--slice-id', 'release-candidate', '--remaining-obligations', '[]',
    '--next-action', 'Create release evidence',
    '--next-command', 'node scripts/release-evidence.mjs create'
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runtime = path.join(repo, '.git', 'zimster');
  const candidate = {
    base_sha: head,
    head_sha: head,
    tree_sha: tree,
    dirty_tree_fingerprint: CLEAN,
    semantic_contract_sha256: 'e'.repeat(64)
  };
  let lifecycle = createReviewLifecycle({
    seam_id: 'whole-release', reviewer_identity: 'reviewer-1', candidate
  });
  for (const event of [{
    type: 'attempt_started',
    attempt: {
      attempt_type: 'initial_review', attempt_id: 'attempt-initial',
      seam_id: 'whole-release', reviewer_identity: 'reviewer-1',
      review_package_id: 'package-initial', candidate
    }
  }, {
    type: 'verdict_recorded', attempt_id: 'attempt-initial', verdict: 'approved', findings: []
  }, {
    type: 'candidate_stabilized'
  }, {
    type: 'attempt_started',
    attempt: {
      attempt_type: 'final_integration_review', attempt_id: 'attempt-final',
      seam_id: 'whole-release', reviewer_identity: 'reviewer-1',
      review_package_id: 'package-final', candidate
    }
  }, {
    type: 'verdict_recorded', attempt_id: 'attempt-final', verdict: 'approved', findings: []
  }]) lifecycle = applyReviewLifecycleEvent(lifecycle, event);
  await mkdir(path.join(runtime, 'review-lifecycle'), { recursive: true });
  await writeFile(
    path.join(runtime, 'review-lifecycle', 'whole-release.json'),
    `${JSON.stringify(lifecycle, null, 2)}\n`
  );
  await mkdir(path.join(runtime, 'assurance-accounting'), { recursive: true });
  const attempts = ['attempt-initial', 'attempt-final'];
  await writeFile(path.join(runtime, 'assurance-accounting', 'latest.json'), `${JSON.stringify({
    schema_version: 1,
    candidate_head: head,
    candidate_tree: tree,
    observed_agent_ids: ['reviewer-1'],
    dispatch_agent_ids: ['reviewer-1'],
    budget_agent_ids: ['reviewer-1'],
    observed_review_attempt_ids: attempts,
    recorded_review_attempt_ids: attempts,
    recorded_review_attempt_counts: { correction_rechecks: 0, final_integration_reviews: 1 },
    budget_review_attempt_counts: { correction_rechecks: 0, final_integration_reviews: 1 },
    observed_max_depth: 1,
    allowed_max_depth: 1,
    reconciliation_complete: true
  }, null, 2)}\n`);
  const budgetFile = path.join(runtime, 'budget.json');
  const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
  budget.usage.complete_suite_executions = 0;
  budget.usage.exact_duplicate_commands = 0;
  budget.usage.final_integration_reviews = 1;
  await writeFile(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
  result = spawnSync(process.execPath, [
    path.join(root, 'scripts/run-control.mjs'), 'refresh'
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { repo, head, tree };
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
    const { repo, head: commit, tree } = await coherentReleaseRepo(directory);
    const dist = path.join(directory, 'dist');
    await createPackages(dist);
    const semantic = path.join(directory, 'semantic.json');
    const matrix = path.join(directory, 'hosts.json');
    const verification = path.join(directory, 'verification.json');
    for (const [file, value] of [[semantic, { verdict: 'approved' }], [matrix, { hosts: [] }], [verification, { status: 'passed' }]]) {
      await writeFile(file, `${JSON.stringify(value)}\n`);
    }
    const postmortemResult = spawnSync(process.execPath, [
      path.join(root, 'scripts/run-postmortem.mjs')
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(postmortemResult.status, 0, postmortemResult.stderr || postmortemResult.stdout);
    const postmortem = JSON.parse(postmortemResult.stdout).report;
    const output = path.join(directory, 'release-evidence.json');
    const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const tag = `v${version}`;
    let result = run([
      'create', '--version', version, '--tag', tag, '--channel', 'public_beta',
      '--commit', commit, '--tree', tree,
      '--standards-lock', path.join(root, 'config/standards-lock.json'),
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--postmortem', postmortem,
      '--dist', dist, '--output', output
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(evidence.schema_version, 3);
    assert.equal(evidence.commit, commit);
    assert.equal(evidence.tree, tree);
    assert.deepEqual(Object.keys(evidence.embedded_inputs).sort(), [
      'host_matrix_base64', 'postmortem_base64', 'semantic_review_base64', 'verification_base64'
    ]);
    assert.equal(
      Buffer.from(evidence.embedded_inputs.semantic_review_base64, 'base64').toString(),
      await readFile(semantic, 'utf8')
    );
    assert.deepEqual(evidence.artifacts.map(({ name }) => name), [
      `zimster-${version}-claude.zip`, `zimster-${version}-codex.zip`,
      `zimster-${version}-openai.zip`, `zimster-${version}-portable.zip`, `zimster-${version}.tgz`
    ]);
    result = run([
      'verify', '--file', output, '--expected-tag', tag, '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', path.join(root, 'config/standards-lock.json'),
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--postmortem', postmortem,
      '--dist', dist
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeFile(verification, '{"status":"changed"}\n');
    result = run([
      'verify', '--file', output, '--expected-tag', tag, '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', path.join(root, 'config/standards-lock.json'),
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--postmortem', postmortem,
      '--dist', dist
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verification.*digest/i);

    await writeFile(verification, '{"status":"passed"}\n');
    const runtime = path.join(repo, '.git', 'zimster');
    const budget = JSON.parse(await readFile(path.join(runtime, 'budget.json'), 'utf8'));
    budget.usage.complete_suite_executions += 1;
    await writeFile(path.join(runtime, 'budget.json'), `${JSON.stringify(budget, null, 2)}\n`);
    result = run([
      'verify', '--file', output, '--expected-tag', tag, '--expected-commit', commit,
      '--expected-tree', tree, '--standards-lock', path.join(root, 'config/standards-lock.json'),
      '--semantic-review', semantic, '--host-matrix', matrix, '--verification', verification,
      '--postmortem', postmortem, '--dist', dist
    ], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /postmortem.*stale|stale.*postmortem/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('v0.6.0 baseline records the true immutable release object and rejects local archive provenance', async () => {
  const baseline = JSON.parse(await readFile(path.join(root, 'release/baselines/v0.6.0.json'), 'utf8'));
  assert.equal(baseline.tag, 'v0.6.0');
  assert.equal(baseline.commit, '9b128196dc058d92117edeaf0dcd670e946f67db');
  assert.equal(baseline.tree, 'c5cebddf1426ba8d488e5c4cc9f053823ad9483d');
  assert.equal(baseline.local_archives_trusted, false);
});
