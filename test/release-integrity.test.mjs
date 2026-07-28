import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { json, read, root } from './helpers.mjs';

test('release metadata and current changelog are synchronized', async () => {
  const pkg = await json('package.json');
  const result = spawnSync(process.execPath, ['scripts/check-version.mjs', '--tag', `v${pkg.version}`], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const changelog = await read('CHANGELOG.md');
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')}(?:\\s|—|-)`, 'm'));
});

test('release workflow rejects tags that disagree with plugin metadata', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /version:check.*--tag.*GITHUB_REF_NAME/);
  assert.match(workflow, /npm run check/);
});

test('version bump synchronizes manifests, lockfile, changelog, and Codex mirror', async () => {
  const bump = await read('scripts/bump-version.mjs');
  const versionFiles = await read('scripts/lib/version-files.mjs');
  assert.match(bump, /CHANGELOG\.md/);
  assert.match(bump, /syncCodexPlugin/);
  for (const file of ['package.json', 'package-lock.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.kimi-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    assert.match(versionFiles, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
