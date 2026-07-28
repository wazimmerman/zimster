import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackages } from '../scripts/package.mjs';
import { json } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.mjs';

async function bytes(file) {
  return readFile(file);
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
    const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(claudeArchive.includes(Buffer.from(`"source_commit": "${sourceCommit}"`)), true);
    assert.equal(claudeArchive.includes(Buffer.from('"package_target": "claude"')), true);
    assert.equal(codexArchive.includes(Buffer.from('"package_target": "codex"')), true);
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
