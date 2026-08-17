import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(command, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(command, args, { cwd, encoding: 'utf8', env });
}

test('evidence receipts bound requirements, claims, and environment scope', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-evidence-scope-'));
  try {
    assert.equal(run('git', ['init', '-b', 'main'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.name', 'Zimster Test'], repo).status, 0);
    assert.equal(run('git', ['config', 'user.email', 'test@example.com'], repo).status, 0);
    await writeFile(path.join(repo, 'fixture.txt'), 'fixture\n');
    assert.equal(run('git', ['add', 'fixture.txt'], repo).status, 0);
    assert.equal(run('git', ['commit', '-m', 'fixture'], repo).status, 0);

    const result = run(process.execPath, [
      path.join(root, 'scripts/evidence.mjs'),
      'record',
      '--kind', 'test',
      '--scope', 'focused',
      '--command', 'node --test wrapper.test.mjs',
      '--exit-code', '0',
      '--tests-discovered', '1',
      '--tests-passed', '1',
      '--tests-failed', '0',
      '--tests-skipped', '0',
      '--requirement-ids', 'EVIDENCE-001,CLAIM-001,CTRL-PACKAGE-001',
      '--establishes', JSON.stringify([
        'Default wrapper invocation works.',
        'Arguments, quoting, and order are forwarded.'
      ]),
      '--does-not-establish', JSON.stringify([
        'Custom locations, inherited configuration, and precedence are compatible.'
      ]),
      '--environment-scope', 'native-default-wrapper-harness',
      '--harness', 'codex'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.requirement_ids, [
      'EVIDENCE-001', 'CLAIM-001', 'CTRL-PACKAGE-001'
    ]);
    assert.deepEqual(receipt.establishes, [
      'Default wrapper invocation works.',
      'Arguments, quoting, and order are forwarded.'
    ]);
    assert.deepEqual(receipt.does_not_establish, [
      'Custom locations, inherited configuration, and precedence are compatible.'
    ]);
    assert.equal(receipt.environment_scope, 'native-default-wrapper-harness');

    const ledgerPath = path.join(repo, '.git', 'zimster', 'evidence', 'receipts.jsonl');
    const ledger = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(ledger.at(-1).id, receipt.id);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('evidence schema accepts runtime scopes and requires semantic scope fields in v2', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'schemas/evidence.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.scope, {
    type: 'string',
    minLength: 1
  });
  const versionTwoRule = schema.allOf.find(
    ({ if: condition }) => condition?.properties?.schema_version?.const === 2
  );
  for (const field of [
    'requirement_ids',
    'establishes',
    'does_not_establish',
    'environment_scope'
  ]) {
    assert.equal(versionTwoRule.then.required.includes(field), true);
  }
  const idPattern = new RegExp(schema.properties.requirement_ids.items.pattern);
  assert.equal(idPattern.test('CTRL-PACKAGE-001'), true);
  assert.equal(idPattern.test('CTRL-package-001'), false);
});

test('semantic review schema binds the stable semantic contract separately from matrix state', async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, 'schemas/semantic-review.schema.json'), 'utf8')
  );
  assert.equal(schema.required.includes('requirement_matrix_sha256'), true);
  assert.equal(schema.required.includes('semantic_contract_sha256'), true);
  assert.deepEqual(schema.properties.semantic_contract_sha256, {
    type: 'string',
    pattern: '^[0-9a-f]{64}$'
  });
  assert.deepEqual(schema.properties.attempt_type.enum, [
    'initial_review',
    'correction_recheck',
    'new_design_review',
    'final_integration_review'
  ]);
});

test('requirement matrix schema and template use exact-tree scopes and the pending lifecycle state', async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, 'schemas/requirement-matrix.schema.json'), 'utf8')
  );
  const template = JSON.parse(
    await readFile(path.join(root, 'templates/requirement-matrix.json'), 'utf8')
  );
  const treeRule = schema.$defs.requirement.properties.evidence_scope.properties.git_tree;
  assert.deepEqual(treeRule.anyOf, [
    { const: 'any' },
    { type: 'string', pattern: '^[0-9a-f]{40}$' }
  ]);
  assert.ok(schema.$defs.requirement.properties.status.enum.includes('pending'));
  assert.match(template.requirements[0].evidence_scope.git_tree, /^[0-9a-f]{40}$/);
  assert.equal(template.requirements[0].evidence_scope.git_tree, template.candidate_tree);
  const idPattern = new RegExp(schema.$defs.requirementId.pattern);
  assert.equal(idPattern.test('CTRL-PACKAGE-001'), true);
});
