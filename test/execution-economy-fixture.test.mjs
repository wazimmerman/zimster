import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { json, root } from './helpers.mjs';

test('execution-economy fixture demonstrates dedup, budget, checkpoint resume, and compact verification', () => {
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/evaluate-execution-economy.mjs')
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.length < 2000);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.command_deduplication, 'reused_without_execution');
  assert.equal(summary.budget_response, 'BUDGET_WARNING');
  assert.equal(summary.checkpoint_resumption, 'passed');
  assert.equal(summary.verification.status, 'passed');
  assert.ok(summary.verification.summary_bytes < 2000);
});

test('package exposes the deterministic execution-economy fixture', async () => {
  const pkg = await json('package.json');
  assert.equal(pkg.scripts['evaluate:economy'], 'node scripts/evaluate-execution-economy.mjs');
});
