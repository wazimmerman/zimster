import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const roles = [
  'zimster-scout',
  'zimster-diagnostician',
  'zimster-integration-reviewer',
  'zimster-test-reviewer'
];

test('Codex role templates are explicit read-only config layers with descendant tools disabled', async () => {
  for (const role of roles) {
    const content = await readFile(path.join(root, 'templates', 'codex-agents', `${role}.toml`), 'utf8');
    assert.match(content, new RegExp(`^name = "${role}"$`, 'm'));
    assert.match(content, /^description = ".+"$/m);
    assert.match(content, /^developer_instructions = """$/m);
    assert.match(content, /^sandbox_mode = "read-only"$/m);
    assert.match(content, /\[agents\][\s\S]*?enabled = false/);
    assert.match(content, /\[features\][\s\S]*?multi_agent = false/);
    assert.match(content, /\[features\][\s\S]*?multi_agent_v2 = false/);
  }
});

test('current standalone Codex accepts copied project role templates', async (context) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'zimster-codex-role-project-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'zimster-codex-role-home-'));
  try {
    assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: fixture }).status, 0);
    const destination = path.join(fixture, '.codex', 'agents');
    await mkdir(destination, { recursive: true });
    await cp(path.join(root, 'templates', 'codex-agents'), destination, { recursive: true });
    const result = spawnSync('codex', [
      '-C', fixture, 'features', 'list'
    ], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: codexHome }
    });
    if (result.error?.code === 'ENOENT') {
      context.skip('Codex CLI is unavailable');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^multi_agent\s+/m);
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('Codex V2 guidance names the current reusable lifecycle without close_agent', async () => {
  const guide = await readFile(
    path.join(root, 'skills', 'using-zimster', 'references', 'codex-tools.md'),
    'utf8'
  );
  assert.doesNotMatch(guide, /close agents|close_agent/i);
  for (const operation of [
    'spawn_agent', 'followup_task', 'send_message',
    'wait_agent', 'list_agents', 'interrupt_agent'
  ]) assert.match(guide, new RegExp(operation));
});
