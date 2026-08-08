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
  assert.match(workflow, /git verify-tag/);
  assert.match(workflow, /release:evidence.*verify-tag/);
  assert.match(workflow, /attest-build-provenance/);
  assert.match(workflow, /environment:\s*release/);
  assert.match(workflow, /npm publish/);
  assert.match(workflow, /gh release.*--draft/);
  assert.doesNotMatch(workflow, /semantic-assurance\.mjs.*complete/);
});

test('version bump synchronizes manifests, lockfile, changelog, and Codex mirror', async () => {
  const bump = await read('scripts/bump-version.mjs');
  const versionFiles = await read('scripts/lib/version-files.mjs');
  assert.match(bump, /CHANGELOG\.md/);
  assert.match(bump, /syncCodexPlugin/);
  for (const file of ['package.json', 'package-lock.json', 'plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.kimi-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
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
    'npm run checksums', 'npm run release:verify', 'npm run postmortem',
    'git diff --check'
  ]) {
    assert.match(releasing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(releasing, /secret/i);
  assert.match(releasing, /Codex[\s\S]*isolated|isolated[\s\S]*Codex/i);
  assert.match(releasing, /installed-package smoke[\s\S]*final integration review/i);
});

test('current release docs use the synchronized package version and honest evaluation status', async () => {
  const pkg = await json('package.json');
  const readme = await read('README.md');
  const evaluation = await read('docs/EVALUATION.md');
  assert.match(readme, new RegExp(`Version ${pkg.version.replaceAll('.', '\\.')}`));
  assert.match(evaluation, /Primary v0\.7\.0 pilot/);
  assert.match(evaluation, /paired risk difference/);
});

test('public pilot docs distinguish the skills treatment from package proof and general replication', async () => {
  const evaluation = await read('docs/EVALUATION.md');
  assert.match(evaluation, /portable Agent Skills workflow\s+in Codex/i);
  assert.match(evaluation, /does not (?:exercise|evaluate)[\s\S]*every host-specific capability/i);
  assert.match(evaluation, /package[\s\S]*correctness[\s\S]*established separately[\s\S]*mechanism tests/i);
  assert.match(evaluation, /record authentication and billing mode/i);
  assert.match(evaluation, /hold\s+(?:both|them) constant between conditions/i);
  assert.match(evaluation, /never silently change[\s\S]*model[\s\S]*provider[\s\S]*authentication/i);
  assert.match(evaluation, /exact model[\s\S]*reasoning level[\s\S]*CLI\s+version[\s\S]*runner version[\s\S]*task locks[\s\S]*plugin condition/i);
  assert.match(evaluation, /prespecified minimum pilot|minimum feasibility pilot/i);
  assert.doesNotMatch(evaluation, /minimum interpretable pilot/i);

  const roadmap = await read('docs/ROADMAP.md');
  assert.match(roadmap, /completed prespecified minimum\s+paired pilot/i);
  assert.doesNotMatch(roadmap, /largest complete paired pilot[\s\S]*included ChatGPT Pro usage/i);
});

test('public host claims do not exceed the claim-scoped host receipt', async () => {
  for (const file of [
    'README.md', 'docs/COMPATIBILITY.md', 'docs/CLAUDE.md',
    'docs/GROK.md', 'docs/KNOWN_LIMITATIONS.md'
  ]) {
    const content = await read(file);
    assert.doesNotMatch(content, /Claude(?: Code)?[^\n|]*\|[^\n]*`LIVE_VERIFIED`|Claude(?: Code)?[\s\S]{0,100}Verification level[\s\S]{0,100}`LIVE_VERIFIED`/i);
    assert.doesNotMatch(content, /Grok[^\n|]*\|[^\n]*`LIVE_VERIFIED`|Grok[\s\S]{0,100}Verification level[\s\S]{0,100}`LIVE_VERIFIED`/i);
  }
});
