import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { json, root } from './helpers.mjs';

const agentPluginsSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const pluginFields = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'extensions'
]);

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must begin with YAML frontmatter');
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `invalid frontmatter line: ${line}`);
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
}

test('root plugin manifest is the closed Agent Plugins 1.0.0 contract', async () => {
  const manifest = await json('plugin.json');
  assert.equal(manifest.$schema, agentPluginsSchema);
  assert.equal(manifest.name, 'zimster');
  assert.equal(manifest.version, '0.7.0');
  assert.equal(manifest.homepage, 'https://zimster.dev');
  assert.deepEqual(Object.keys(manifest).filter((key) => !pluginFields.has(key)), []);
});

test('standards sources are pinned to immutable upstream revisions', async () => {
  const lock = await json('config/standards-lock.json');
  assert.equal(lock.schema_version, 1);
  assert.equal(lock.agent_plugins.version, '1.0.0');
  assert.equal(lock.agent_plugins.commit, '1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1');
  assert.equal(lock.agent_skills.commit, '217be548739f21d6008915c29aefe320ea1a90af');
  for (const standard of Object.values(lock).filter((value) => typeof value === 'object')) {
    assert.match(standard.source, /^https:\/\//);
    assert.match(standard.license, /Apache-2\.0|CC-BY-4\.0/);
  }
});

test('every immediate skill satisfies the portable Agent Skills contract', async () => {
  const entries = await readdir(path.join(root, 'skills'), { withFileTypes: true });
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const files = await readdir(path.join(root, 'skills', entry.name));
    assert.ok(files.includes('SKILL.md'), `${entry.name} must contain exact SKILL.md casing`);
    const source = await readFile(path.join(root, 'skills', entry.name, 'SKILL.md'), 'utf8');
    const metadata = frontmatter(source);
    assert.equal(metadata.name, entry.name);
    assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(metadata.name.length <= 64);
    assert.ok(metadata.description.length <= 1024);
    assert.ok(!/[<>]/.test(metadata.description));
    assert.doesNotMatch(source, /`scripts\//, `${entry.name} contains an ambiguous repository-relative helper path`);
  }
});
