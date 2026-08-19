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
  const trackedEvidence = spawnSync('git', ['ls-files', 'release/evidence'], {
    cwd: root, encoding: 'utf8'
  });
  assert.equal(trackedEvidence.status, 0, trackedEvidence.stderr);
  assert.equal(trackedEvidence.stdout, '');
  assert.match(workflow, /git verify-tag/);
  assert.match(workflow, /release:evidence.*verify-tag/);
  assert.match(workflow, /attest-build-provenance/);
  assert.match(workflow, /environment:\s*release/);
  assert.match(workflow, /npm publish/);
  assert.match(workflow, /gh api --method POST[\s\S]*-F draft=true/);
  assert.doesNotMatch(workflow, /semantic-assurance\.mjs.*complete/);
  assert.doesNotMatch(workflow, /release\/evidence\/(?:semantic-review|host-matrix|verification)\.json/);
  assert.match(workflow, /release:evidence -- extract-tag/);
  assert.match(workflow, /\$RUNNER_TEMP/);
});

test('release workflow establishes the configured public-key trust anchor before both tag checks', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const keySetup = workflow.indexOf('.github/scripts/release-signing-key.mjs');
  const verifyTag = workflow.indexOf('git verify-tag "$RELEASE_TAG"');
  const evidenceVerify = workflow.indexOf('release:evidence -- verify-tag');
  assert.notEqual(keySetup, -1);
  assert.notEqual(verifyTag, -1);
  assert.notEqual(evidenceVerify, -1);
  assert.ok(keySetup < verifyTag);
  assert.ok(verifyTag < evidenceVerify);
  assert.match(workflow, /\.github\/release-keys\/william-zimmerman\.asc/);
  assert.match(workflow, /RELEASE_SIGNER_FINGERPRINT:\s*\$\{\{ vars\.RELEASE_SIGNER_FINGERPRINT \}\}/);
  assert.match(workflow, /GNUPGHOME:\s*\$\{\{ runner\.temp \}\}/);
  assert.match(workflow, /--trusted-fingerprint\s+"\$RELEASE_SIGNER_FINGERPRINT"/);
  assert.match(workflow, /release:evidence[\s\S]*verify-tag[\s\S]*--trusted-fingerprint/);
});

test('release workflow preserves and verifies the signed annotated tag before peeling its commit', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const fetchTag = workflow.indexOf('+refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG');
  const tagType = workflow.indexOf('git cat-file -t "$RELEASE_TAG"');
  const verifyTag = workflow.indexOf('git verify-tag "$RELEASE_TAG"');
  const peelTag = workflow.indexOf('git rev-parse "$RELEASE_TAG^{}"');
  const checkoutCommit = workflow.indexOf('git checkout --detach "$RELEASE_COMMIT"');
  const extractTag = workflow.indexOf('release:evidence -- extract-tag');
  assert.ok(fetchTag !== -1 && tagType !== -1 && verifyTag !== -1 && peelTag !== -1 && checkoutCommit !== -1);
  assert.ok(fetchTag < tagType);
  assert.ok(tagType < verifyTag);
  assert.ok(verifyTag < peelTag);
  assert.ok(peelTag < checkoutCommit);
  assert.ok(checkoutCommit < extractTag);
  assert.match(workflow, /test "\$RELEASE_COMMIT" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /refs\/tags\/\$RELEASE_TAG:[^\n]*\$RELEASE_COMMIT/);
});

test('release workflow recovers an existing signed tag without weakening push or evidence verification', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+release_tag:\s*\n(?:\s+[^\n]+\n)*?\s+required:\s*true/);
  assert.match(workflow, /RELEASE_TAG:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.release_tag \|\| github\.ref_name\s*\}\}/);
  const jobGate = workflow.indexOf("if: ${{ github.event_name == 'push' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}");
  const runner = workflow.indexOf('runs-on: ubuntu-latest');
  assert.ok(jobGate !== -1 && jobGate < runner);
  assert.doesNotMatch(workflow, /DEFAULT_BRANCH|GITHUB_EVENT_NAME" = "workflow_dispatch/);
  assert.match(workflow, /if test "\$GITHUB_EVENT_NAME" = "push"; then\s*\n\s+test "\$RELEASE_COMMIT" = "\$GITHUB_SHA"\s*\n\s+fi/);

  const verifyTag = workflow.indexOf('git verify-tag "$RELEASE_TAG"');
  const peelTag = workflow.indexOf('git rev-parse "$RELEASE_TAG^{}"');
  const pushGuard = workflow.indexOf('if test "$GITHUB_EVENT_NAME" = "push"; then');
  const exactTarget = workflow.indexOf('test "$RELEASE_COMMIT" = "$GITHUB_SHA"');
  const checkout = workflow.indexOf('git checkout --detach "$RELEASE_COMMIT"');
  const extract = workflow.indexOf('release:evidence -- extract-tag');
  const evidenceVerify = workflow.indexOf('release:evidence -- verify-tag');
  assert.ok([
    verifyTag, peelTag, pushGuard, exactTarget, checkout, extract, evidenceVerify
  ].every((position) => position !== -1));
  assert.ok(verifyTag < peelTag);
  assert.ok(peelTag < pushGuard);
  assert.ok(pushGuard < exactTarget);
  assert.ok(exactTarget < checkout);
  assert.ok(checkout < extract);
  assert.ok(extract < evidenceVerify);
  assert.equal(workflow.match(/test "\$RELEASE_COMMIT" = "\$GITHUB_SHA"/g)?.length, 1);
});

test('release workflow trusts embedded inputs only after signature verification and rebuilds before authorization', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const verifySignature = workflow.indexOf('git verify-tag "$RELEASE_TAG"');
  const exactTarget = workflow.indexOf('test "$RELEASE_COMMIT" = "$GITHUB_SHA"');
  const checkout = workflow.indexOf('git checkout --detach "$RELEASE_COMMIT"');
  const npmCi = workflow.indexOf('npm ci');
  const check = workflow.indexOf('npm run check');
  const version = workflow.indexOf('npm run version:check');
  const extract = workflow.indexOf('release:evidence -- extract-tag');
  const authorization = workflow.indexOf('release:evidence -- verify-tag');
  const checksums = workflow.indexOf('npm run checksums');
  assert.ok([
    verifySignature, exactTarget, checkout, npmCi, check, version, extract, authorization, checksums
  ].every((position) => position !== -1));
  assert.ok(verifySignature < exactTarget);
  assert.ok(exactTarget < checkout);
  assert.ok(checkout < npmCi);
  assert.ok(npmCi < check);
  assert.ok(check < version);
  assert.ok(version < extract);
  assert.ok(extract < authorization);
  assert.ok(authorization < checksums);
  assert.match(workflow, /--semantic-review\s+"\$RELEASE_EVIDENCE_DIR\/semantic-review\.json"/);
  assert.match(workflow, /--host-matrix\s+"\$RELEASE_EVIDENCE_DIR\/host-matrix\.json"/);
  assert.match(workflow, /--verification\s+"\$RELEASE_EVIDENCE_DIR\/verification\.json"/);
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
  assert.match(workflow, /select\(\.tag_name == env\.RELEASE_TAG\)/);
  assert.match(workflow, /duplicate GitHub releases for exact target tag/);
  assert.match(workflow, /gh api --method POST[\s\S]*-f tag_name="\$RELEASE_TAG"/);
  assert.match(workflow, /releases\/\$RELEASE_ID/);
  assert.match(workflow, /-F prerelease="\$RELEASE_PRERELEASE"/);
  assert.match(workflow, /-f make_latest="\$RELEASE_LATEST"/);
  assert.doesNotMatch(workflow, /releases\/latest|gh release view\s*>/);
});

test('release workflow uses npm Trusted Publishing without a write-capable token', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /permissions:[\s\S]*id-token:\s*write/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /environment:\s*release/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /registry-url:/);

  const nodeVersion = workflow.match(/node-version:\s*['"]?([^\s'"]+)/)?.[1];
  const npmVersion = workflow.match(/npm install --global npm@([^\s]+)/)?.[1];
  assert.equal(nodeVersion, '22.18.0');
  assert.equal(npmVersion, '11.5.1');
  assert.match(workflow, /test "\$\(node --version\)" = "v22\.18\.0"/);

  const authorization = workflow.indexOf('--github-output "$GITHUB_OUTPUT"');
  const publish = workflow.indexOf('npm publish "$ARTIFACT" --access public');
  const expose = workflow.indexOf('Expose authorized GitHub release');
  assert.ok(authorization !== -1 && publish !== -1 && expose !== -1);
  assert.ok(authorization < publish);
  assert.ok(publish < expose);
  assert.doesNotMatch(workflow, /npm publish[^\n]*--provenance/);
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
