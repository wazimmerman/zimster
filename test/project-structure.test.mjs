import test from 'node:test';
import assert from 'node:assert/strict';
import { exists, json } from './helpers.mjs';

const requiredFiles = [
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.kimi-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  '.opencode/plugins/zimster.js',
  '.pi/extensions/zimster.ts',
  'hooks/hooks.json',
  'hooks/hooks-cursor.json',
  'hooks/run-hook.cmd',
  'hooks/session-start',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md',
  'docs/EVALUATION.md',
  'docs/RESEARCH.md',
  'docs/UPSTREAM.md',
  'scripts/validate.mjs',
  'scripts/package.mjs',
  'scripts/doctor.mjs'
];

test('ships the public plugin structure', async () => {
  for (const file of requiredFiles) {
    assert.equal(await exists(file), true, `missing ${file}`);
  }
});

test('all primary manifests agree on name and version', async () => {
  const packageJson = await json('package.json');
  for (const manifestPath of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
    '.kimi-plugin/plugin.json'
  ]) {
    const manifest = await json(manifestPath);
    assert.equal(manifest.name, 'zimster', `${manifestPath} name`);
    assert.equal(manifest.version, packageJson.version, `${manifestPath} version`);
    assert.equal(manifest.license, 'MIT', `${manifestPath} license`);
  }
});

test('Codex is a first-class skill plugin with no accidental Claude hook discovery', async () => {
  const manifest = await json('.codex-plugin/plugin.json');
  assert.equal(manifest.skills, './skills/');
  assert.deepEqual(manifest.hooks, {});
  assert.match(manifest.description, /owner-driven|proof-first/i);
});

test('polyglot hook remains LF so both Bash and cmd.exe can parse it', async () => {
  const { read } = await import('./helpers.mjs');
  const attributes = await read('.gitattributes');
  assert.match(attributes, /^\*\.cmd text eol=lf$/m);
  assert.doesNotMatch(attributes, /^\*\.cmd text eol=crlf$/m);
});
