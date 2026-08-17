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
  assert.match(workflow, /gh api --method POST[\s\S]*-F draft=true/);
  assert.doesNotMatch(workflow, /semantic-assurance\.mjs.*complete/);
});

test('release workflow establishes the configured public-key trust anchor before both tag checks', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const keySetup = workflow.indexOf('.github/scripts/release-signing-key.mjs');
  const verifyTag = workflow.indexOf('git verify-tag "$GITHUB_REF_NAME"');
  const materializeEvidence = workflow.indexOf('release:evidence -- extract-tag');
  const evidenceVerify = workflow.indexOf('release:evidence -- verify-tag');
  assert.notEqual(keySetup, -1);
  assert.notEqual(verifyTag, -1);
  assert.notEqual(materializeEvidence, -1);
  assert.notEqual(evidenceVerify, -1);
  assert.ok(keySetup < verifyTag);
  assert.ok(verifyTag < materializeEvidence);
  assert.ok(materializeEvidence < evidenceVerify);
  assert.match(workflow, /\.github\/release-keys\/william-zimmerman\.asc/);
  assert.match(workflow, /RELEASE_SIGNER_FINGERPRINT:\s*\$\{\{ vars\.RELEASE_SIGNER_FINGERPRINT \}\}/);
  assert.match(workflow, /GNUPGHOME:\s*\$\{\{ runner\.temp \}\}/);
  assert.match(workflow, /--trusted-fingerprint\s+"\$RELEASE_SIGNER_FINGERPRINT"/);
  assert.match(workflow, /release:evidence[\s\S]*verify-tag[\s\S]*--trusted-fingerprint/);
});

test('live GPG fixtures are Linux-only while portable release contracts stay cross-platform', async () => {
  const channel = await read('test/release-channel.test.mjs');
  const signing = await read('test/release-signing.test.mjs');
  const reason = /Linux release runner[\s\S]*macOS and Windows[\s\S]*platform-independent release contract/i;
  assert.match(channel, reason);
  assert.match(signing, reason);
  assert.equal(channel.match(/skip: linuxGpgIntegration/g)?.length, 1);
  assert.equal(signing.match(/skip: linuxGpgIntegration/g)?.length, 4);
  assert.match(channel, /test\('signed public_beta and stable channels[\s\S]*\(\) =>/);
  assert.match(channel, /test\('public beta mapping is independent[\s\S]*\(\) =>/);
});

test('release workflow publishes npm before exposing an explicitly channel-bound GitHub release', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const authorization = workflow.indexOf('--github-output "$GITHUB_OUTPUT"');
  const draft = workflow.indexOf('Prepare draft GitHub release');
  const npmPublish = workflow.indexOf('Publish npm package idempotently');
  const expose = workflow.indexOf('Expose authorized GitHub release');
  assert.ok(authorization !== -1 && draft !== -1 && npmPublish !== -1 && expose !== -1);
  assert.ok(authorization < draft);
  assert.ok(draft < npmPublish);
  assert.ok(npmPublish < expose);
  assert.match(workflow, /steps\.authorization\.outputs\.release_prerelease/);
  assert.match(workflow, /steps\.authorization\.outputs\.release_latest/);
  assert.match(workflow, /steps\.authorization\.outputs\.release_title/);
  assert.match(workflow, /releases\?per_page=100/);
  assert.match(workflow, /select\(\.tag_name == env\.GITHUB_REF_NAME\)/);
  assert.match(workflow, /duplicate GitHub releases for exact target tag/);
  assert.match(workflow, /gh api --method POST[\s\S]*-f tag_name="\$GITHUB_REF_NAME"/);
  assert.match(workflow, /releases\/\$RELEASE_ID/);
  assert.match(workflow, /-F prerelease="\$RELEASE_PRERELEASE"/);
  assert.match(workflow, /-f make_latest="\$RELEASE_LATEST"/);
  assert.doesNotMatch(workflow, /releases\/latest|gh release view\s*>/);
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
  assert.match(evaluation, /controlled, paired\s+DeepSWE pilot/i);
  assert.match(evaluation, /canonical Zimster skills at commit\s+`95dfedf7d396a7b9faa72ced844a28f70bd6bcef`/i);
  assert.match(evaluation, /oversized-request decomposition[\s\S]*optional visual treatment[\s\S]*added[\s\S]*later[\s\S]*tested separately/i);
  assert.match(evaluation, /small pilot of one workflow build/i);
  assert.match(evaluation, /should not be\s+generalized to every task, model, host, or later mechanism/i);
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
  assert.match(roadmap, /completed\s+(?:historical\s+)?prespecified\s+minimum\s+paired pilot/i);
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
