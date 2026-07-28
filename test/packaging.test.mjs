import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import { json } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.mjs';

async function bytes(file) {
  return readFile(file);
}

function storedZipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, archive.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

test('packaging is deterministic and emits Codex and Claude archives', async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), 'zimster-first-'));
  const second = await mkdtemp(path.join(os.tmpdir(), 'zimster-second-'));
  try {
    const firstOutputs = await createPackages(first);
    const secondOutputs = await createPackages(second);
    const { version } = await json('package.json');
    assert.deepEqual(firstOutputs.map((entry) => path.basename(entry)), [
      `zimster-${version}-claude.zip`,
      `zimster-${version}-codex.zip`,
      `zimster-${version}-portable.zip`
    ]);
    for (let index = 0; index < firstOutputs.length; index += 1) {
      assert.deepEqual(await bytes(firstOutputs[index]), await bytes(secondOutputs[index]));
    }

    const codexArchive = await bytes(firstOutputs[1]);
    for (const skill of ['using-zimster', 'owner-driven-development', 'test-driven-development', 'risk-adaptive-review']) {
      assert.equal(
        codexArchive.includes(Buffer.from(`plugins/zimster/skills/${skill}/agents/openai.yaml`)),
        true,
        `Codex archive missing OpenAI metadata for ${skill}`
      );
    }
    assert.equal(codexArchive.includes(Buffer.from('.agents/plugins/marketplace.json')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/.codex-plugin/plugin.json')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/scripts/evidence.mjs')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/scripts/codex-cachebuster.mjs')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/scripts/sync-skills.mjs')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/scripts/review-integrity.mjs')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/config/model-routing.json')), true);
    assert.equal(codexArchive.includes(Buffer.from('plugins/zimster/scripts/lib/runtime.mjs')), true);
    const claudeArchive = await bytes(firstOutputs[0]);
    assert.equal(claudeArchive.includes(Buffer.from('scripts/evidence.mjs')), true);
    for (const required of [
      '.claude-plugin/plugin.json',
      'agents/integration-reviewer.md',
      'agents/test-reviewer.md',
      'hooks/hooks.json',
      'hooks/session-start.mjs'
    ]) {
      assert.equal(claudeArchive.includes(Buffer.from(required)), true, `Claude archive missing ${required}`);
    }
    const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(claudeArchive.includes(Buffer.from(`"source_commit": "${sourceCommit}"`)), true);
    assert.equal(claudeArchive.includes(Buffer.from('"package_target": "claude"')), true);
    assert.equal(codexArchive.includes(Buffer.from('"package_target": "codex"')), true);
    const codexExtracted = await mkdtemp(path.join(os.tmpdir(), 'zimster-codex-package-fallback-'));
    const fallbackTarget = await mkdtemp(path.join(os.tmpdir(), 'zimster-codex-fallback-target-'));
    try {
      for (const [name, data] of storedZipEntries(codexArchive)) {
        if (!name.startsWith('plugins/zimster/')) continue;
        const relative = name.slice('plugins/zimster/'.length);
        const target = path.join(codexExtracted, ...relative.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data);
      }
      assert.equal(
        spawnSync('git', ['init', '-b', 'main'], { cwd: fallbackTarget, encoding: 'utf8' }).status,
        0
      );
      const fallback = spawnSync(process.execPath, [
        path.join(codexExtracted, 'scripts/sync-skills.mjs'), '--target', fallbackTarget
      ], {
        cwd: codexExtracted,
        encoding: 'utf8'
      });
      assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
      const fallbackMetadata = JSON.parse(await readFile(
        path.join(fallbackTarget, '.agents/skills/using-zimster/references/build-metadata.json'),
        'utf8'
      ));
      assert.equal(fallbackMetadata.source_commit, sourceCommit);
      assert.equal(fallbackMetadata.package_target, 'skills-only');
    } finally {
      await rm(codexExtracted, { recursive: true, force: true });
      await rm(fallbackTarget, { recursive: true, force: true });
    }
    const extracted = await mkdtemp(path.join(os.tmpdir(), 'zimster-claude-package-smoke-'));
    try {
      for (const [name, data] of storedZipEntries(claudeArchive)) {
        const target = path.join(extracted, ...name.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data);
      }
      await chmod(path.join(extracted, 'hooks/session-start.mjs'), 0o755);
      const smoke = spawnSync(process.execPath, ['hooks/session-start.mjs'], {
        cwd: extracted,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: extracted },
        input: '{"hook_event_name":"SessionStart","source":"startup"}\n'
      });
      assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
      assert.equal(smoke.stderr, '');
      assert.match(JSON.parse(smoke.stdout).hookSpecificOutput.additionalContext, /# Using Zimster/);
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
    const portableArchive = await bytes(firstOutputs[2]);
    assert.equal(portableArchive.includes(Buffer.from('"package_target": "portable"')), true);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});


test('packaging preserves unrelated files in the output directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'zimster-preserve-'));
  const sentinel = path.join(output, 'keep-me.txt');
  try {
    await writeFile(sentinel, 'unrelated');
    await createPackages(output);
    await access(sentinel);
    assert.equal((await readFile(sentinel, 'utf8')), 'unrelated');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
