import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/capability-cache.mjs'),
    ...args
  ], { cwd, encoding: 'utf8' });
}

test('every harness capability record is dated and linked to primary sources', async () => {
  const matrix = JSON.parse(await readFile(
    path.join(root, 'config/harness-capabilities.json'),
    'utf8'
  ));
  assert.equal(matrix.schema_version, 2);
  for (const [harness, record] of Object.entries(matrix.harnesses)) {
    assert.match(record.checked_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Number.isInteger(record.max_age_days), true, harness);
    assert.ok(record.max_age_days > 0, harness);
    assert.ok(record.sources.length > 0, harness);
    assert.equal(
      record.sources.every(({ url }) => /^https:\/\/[^/]+/.test(url)),
      true,
      harness
    );
  }
});

test('package exposes capability-cache and postmortem commands', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['capability:status'], 'node scripts/capability-cache.mjs status');
  assert.equal(pkg.scripts.postmortem, 'node scripts/run-postmortem.mjs');
});

test('capability refresh decisions are scoped to one host and enumerate only valid triggers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-capability-cache-'));
  try {
    const config = path.join(directory, 'capabilities.json');
    await writeFile(config, `${JSON.stringify({
      schema_version: 2,
      capability_states: ['native', 'unverified'],
      harnesses: {
        codex: {
          checked_at: '2026-07-01T00:00:00.000Z',
          max_age_days: 30,
          local_host_version: '1.2.3',
          validator_status: 'consistent',
          sources: [{ title: 'Codex docs', url: 'https://developers.openai.com/codex/' }],
          verification: 'structurally_validated',
          capabilities: { native_skill_loading: 'native' }
        },
        claude: {
          checked_at: '2020-01-01T00:00:00.000Z',
          max_age_days: 1,
          local_host_version: null,
          validator_status: 'not_run',
          sources: [{ title: 'Claude docs', url: 'https://docs.anthropic.com/' }],
          verification: 'structurally_validated',
          capabilities: { native_skill_loading: 'native' }
        }
      }
    }, null, 2)}\n`);

    let result = run([
      'status', '--config', config, '--harness', 'codex',
      '--now', '2026-07-28T00:00:00.000Z', '--host-version', '1.2.3'
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let summary = JSON.parse(result.stdout);
    assert.deepEqual(summary, {
      schema_version: 1,
      harness: 'codex',
      refresh_required: false,
      reasons: [],
      checked_at: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-07-31T00:00:00.000Z',
      sources: ['https://developers.openai.com/codex/']
    });
    assert.doesNotMatch(result.stdout, /claude/i);

    result = run([
      'status', '--config', config, '--harness', 'codex',
      '--now', '2026-08-02T00:00:00.000Z',
      '--host-version', '2.0.0',
      '--validator-status', 'contradicted',
      '--task-changes-integration',
      '--fresh-research'
    ]);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    summary = JSON.parse(result.stdout);
    assert.equal(summary.refresh_required, true);
    assert.deepEqual(summary.reasons, [
      'configured_age_expired',
      'local_host_version_changed',
      'official_validator_contradiction',
      'current_task_changes_host_integration',
      'user_requested_fresh_research'
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
