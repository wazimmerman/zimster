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

test('release documentation covers diagnostics, skills-only installs, and final gates', async () => {
  const diagnostics = await read('docs/DIAGNOSTICS.md');
  assert.match(diagnostics, /npm run doctor -- --json/);
  assert.match(diagnostics, /quiet fallback/i);
  assert.match(diagnostics, /actionable error/i);

  const skillsOnly = await read('docs/SKILLS_ONLY.md');
  assert.match(skillsOnly, /npm run sync-skills -- --target/);
  assert.match(skillsOnly, /build-metadata\.json/);
  assert.match(skillsOnly, /receipts[\s\S]*unavailable|unavailable[\s\S]*receipts/i);

  const releasing = await read('docs/RELEASING.md');
  for (const command of [
    'npm run version:bump', 'npm run check', 'npm run version:check',
    'npm run checksums', 'git diff --check'
  ]) {
    assert.match(releasing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(releasing, /secret/i);
  assert.match(releasing, /Codex[\s\S]*isolated|isolated[\s\S]*Codex/i);
});

test('current release docs use the synchronized package version and honest evaluation status', async () => {
  const pkg = await json('package.json');
  const readme = await read('README.md');
  const evaluation = await read('docs/EVALUATION.md');
  assert.match(readme, new RegExp(`Version ${pkg.version.replaceAll('.', '\\.')}`));
  assert.match(evaluation, new RegExp(`Version ${pkg.version.replaceAll('.', '\\.')}`));
  assert.match(evaluation, /does not claim to beat Superpowers/);
});
