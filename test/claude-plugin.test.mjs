import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { exists, json, read, root } from './helpers.mjs';

const SESSION_START_OUTPUT_LIMIT_BYTES = 10_000;
const SESSION_START_OUTPUT_TARGET_BYTES = 9_800;
const REQUIRED_BOOTSTRAP_SECTIONS = [
  '# Using Zimster',
  '## Select the smallest workflow',
  '## Deterministic execution profile',
  '## Semantic assurance contract',
  '## Durable state trigger',
  '## Delegation and model routing',
  '## Cost controls',
  '## Logical ownership and phase checkpoints',
  '## Deterministic verification and evidence reuse',
  '## Capability research and postmortem',
  '## Harness adaptation',
  '## Installed version and script-free mode'
];

function assertSessionStartOutputSize(output, maximum = SESSION_START_OUTPUT_LIMIT_BYTES) {
  const bytes = Buffer.byteLength(output, 'utf8');
  assert.ok(
    bytes <= maximum,
    `SessionStart output is ${bytes} UTF-8 bytes; maximum is ${maximum}`
  );
  return bytes;
}

function frontmatter(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(block, 'agent must contain YAML frontmatter');
  return Object.fromEntries(block.split('\n').map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

function values(field) {
  return new Set(field.split(',').map((value) => value.trim()).filter(Boolean));
}

test('Claude manifest and validator expose only current plugin metadata', async () => {
  const manifest = await json('.claude-plugin/plugin.json');
  assert.deepEqual(
    new Set(Object.keys(manifest)),
    new Set(['name', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords'])
  );
  assert.equal(await exists('scripts/validate-claude-plugin.mjs'), true);
  const result = spawnSync(process.execPath, ['scripts/validate-claude-plugin.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Claude plugin.*valid/i);
});

test('Claude static reviewer is technically read/search-only with bounded judgment settings', async () => {
  const metadata = frontmatter(await read('agents/integration-reviewer.md'));
  assert.deepEqual(values(metadata.tools), new Set(['Read', 'Grep', 'Glob']));
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent']) {
    assert.equal(values(metadata.disallowedTools).has(tool), true, `${tool} must be denied explicitly`);
  }
  assert.equal(metadata.model, 'inherit');
  assert.equal(metadata.effort, undefined);
  assert.equal(metadata.maxTurns, '24');
  for (const unsupported of ['permissionMode', 'hooks', 'mcpServers']) {
    assert.equal(metadata[unsupported], undefined);
  }
});

test('Claude focused reviewer is bounded and isolated in a temporary worktree', async () => {
  const content = await read('agents/test-reviewer.md');
  const metadata = frontmatter(content);
  assert.deepEqual(values(metadata.tools), new Set(['Read', 'Grep', 'Glob', 'Bash']));
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Agent']) {
    assert.equal(values(metadata.disallowedTools).has(tool), true, `${tool} must be denied explicitly`);
  }
  assert.equal(metadata.model, 'inherit');
  assert.equal(metadata.effort, undefined);
  assert.equal(metadata.maxTurns, '24');
  assert.equal(metadata.isolation, 'worktree');
  assert.match(content, /named focused command|named command/i);
  assert.match(content, /artifact|output contract/i);
  assert.match(content, /stop condition/i);
  assert.match(content, /committed.*immutable|immutable.*committed/is);
  assert.match(content, /git switch --detach/);
  assert.match(content, /owner.*capture.*verify|owner.*before.*after/is);
  assert.match(content, /review-integrity\.mjs.*capture/is);
  assert.match(content, /review-integrity\.mjs.*verify/is);
});

test('Claude SessionStart covers startup resume clear and compact with one compact bootstrap', async () => {
  const hooks = await json('hooks/hooks.json');
  const canonicalBootstrap = await read('skills/using-zimster/SKILL.md');
  const generatedBootstrap = await read('plugins/zimster/skills/using-zimster/SKILL.md');
  assert.equal(generatedBootstrap, canonicalBootstrap);
  const entry = hooks.hooks.SessionStart[0];
  assert.deepEqual(new Set(entry.matcher.split('|')), new Set(['startup', 'resume', 'clear', 'compact']));
  assert.equal(entry.hooks.length, 1);
  assert.deepEqual(
    new Set(Object.keys(entry.hooks[0])),
    new Set(['type', 'command', 'args', 'async'])
  );
  assert.equal(entry.hooks[0].type, 'command');
  assert.equal(entry.hooks[0].command, 'node');
  assert.deepEqual(entry.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs']);
  assert.equal(entry.hooks[0].async, false);

  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const result = spawnSync(process.execPath, ['hooks/session-start.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
      input: `${JSON.stringify({ hook_event_name: 'SessionStart', source })}\n`
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(context.match(/zimster:using-zimster bootstrap/g)?.length, 1);
    assert.equal(context.match(/<ZIMSTER_BOOTSTRAP>/g)?.length, 1);
    assert.match(context, /# Using Zimster/);
    for (const section of REQUIRED_BOOTSTRAP_SECTIONS) {
      assert.equal(
        context.split(section).length - 1,
        1,
        `SessionStart bootstrap must contain exactly one ${section} section`
      );
    }
    assert.match(context, /<SUBAGENT-STOP>[\s\S]*does not restart[\s\S]*recruit more agents/);
    assert.match(context, /User and repository instructions override Zimster defaults/);
    assert.match(context, /Always report the selected profile and its risk rationale/);
    assert.match(context, /`REVIEW_CHECKOUT_UNCHANGED` or\s+`REVIEW_CHECKOUT_CHANGED`/);
    assert.match(context, /Owner-inline review is always `self_review`/);
    assert.match(context, /cannot satisfy Standard or\s+High-risk independent review/);
    assert.match(context, /Only the deterministic completion gate may\s+emit `CANDIDATE_COMPLETE`/);
    assert.match(context, /scripts\/init-run\.mjs[\s\S]*git rev-parse --git-path zimster\/run\.md/);
    assert.match(context, /config\/model-routing\.json[\s\S]*scripts\/dispatch-record\.mjs/);
    assert.match(context, /Never lower a required\s+quality gate silently/);
    assert.match(context, /The logical owner is continuous/);
    assert.match(context, /Required fresh final\s+gates are never reused/);
    assert.match(context, /observed, inferred, and unavailable metrics\s+distinct/);
    assert.match(context, /Read only the matching reference/);
    assert.match(context, /references\/build-metadata\.json/);
    assert.match(context, /Without scripts, continue quietly/);
    const bytes = assertSessionStartOutputSize(result.stdout);
    assert.ok(
      bytes <= SESSION_START_OUTPUT_TARGET_BYTES,
      `SessionStart output is ${bytes} UTF-8 bytes; correction target is ${SESSION_START_OUTPUT_TARGET_BYTES}`
    );
  }
});

test('SessionStart byte contract measures UTF-8 and rejects an oversized payload', () => {
  const oversized = 'é'.repeat(5_001);
  assert.equal(oversized.length, 5_001);
  assert.equal(Buffer.byteLength(oversized, 'utf8'), 10_002);
  assert.throws(
    () => assertSessionStartOutputSize(oversized),
    /10002 UTF-8 bytes; maximum is 10000/
  );
});

test('Claude SessionStart reports a missing required bootstrap as an actionable error', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-claude-hook-error-'));
  try {
    await mkdir(path.join(temporary, 'hooks'), { recursive: true });
    await cp(path.join(root, 'hooks/session-start.mjs'), path.join(temporary, 'hooks/session-start.mjs'));
    const result = spawnSync(process.execPath, [path.join(temporary, 'hooks/session-start.mjs')], {
      cwd: temporary,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: temporary },
      input: '{"hook_event_name":"SessionStart","source":"startup"}\n'
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /using-zimster.*missing|cannot read.*using-zimster/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Claude SessionStart runs from a plugin path with spaces without Bash', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'zimster claude node hook '));
  const temporary = path.join(parent, 'plugin with spaces');
  try {
    await mkdir(path.join(temporary, 'hooks'), { recursive: true });
    await mkdir(path.join(temporary, 'skills', 'using-zimster'), { recursive: true });
    await cp(path.join(root, 'hooks/session-start.mjs'), path.join(temporary, 'hooks/session-start.mjs'));
    await cp(
      path.join(root, 'skills/using-zimster/SKILL.md'),
      path.join(temporary, 'skills/using-zimster/SKILL.md')
    );
    const result = spawnSync(process.execPath, [path.join(temporary, 'hooks/session-start.mjs')], {
      cwd: temporary,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: temporary },
      input: '{"hook_event_name":"SessionStart","source":"startup"}\n'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /# Using Zimster/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('Claude guide documents local validation, lifecycle, restrictions, and honest status', async () => {
  assert.equal(await exists('docs/CLAUDE.md'), true);
  const guide = await read('docs/CLAUDE.md');
  for (const pattern of [
    /claude plugin validate/,
    /marketplace add/,
    /plugin install/,
    /plugin marketplace update/,
    /plugin uninstall/,
    /SessionStart/,
    /integration-reviewer/,
    /test-reviewer/,
    /2\.1\.233/,
    /12 skills, 4 agents, and (?:1|one)\s+SessionStart hook/,
    /model-backed.*not|not.*model-backed/is
  ]) {
    assert.match(guide, pattern);
  }
});
