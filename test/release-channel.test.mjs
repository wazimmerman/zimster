import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as releaseEvidence from '../scripts/lib/release-evidence.mjs';
import { root } from './helpers.mjs';

const expectedPublicBeta = {
  channel: 'public_beta',
  title: 'Zimster 0.7.0 - Public Beta',
  prerelease: true,
  latest: false
};
const linuxGpgIntegration = process.platform === 'linux'
  ? false
  : 'Cryptographic integration targets the Linux release runner; macOS and Windows continue to exercise the platform-independent release contract.';

test('signed public_beta and stable channels map to explicit GitHub release state', () => {
  assert.equal(typeof releaseEvidence.githubReleaseState, 'function');
  assert.deepEqual(releaseEvidence.githubReleaseState({
    version: '0.7.0', tag: 'v0.7.0', channel: 'public_beta'
  }), expectedPublicBeta);
  assert.deepEqual(releaseEvidence.githubReleaseState({
    version: '1.0.0', tag: 'v1.0.0', channel: 'stable'
  }), {
    channel: 'stable',
    title: 'Zimster 1.0.0',
    prerelease: false,
    latest: true
  });
});

test('public beta mapping is independent of SemVer recency and historical Latest state', () => {
  assert.equal(typeof releaseEvidence.githubReleaseState, 'function');
  const history = [
    { tag: 'v0.1.0', prerelease: false, latest: false },
    { tag: 'v0.5.0', prerelease: false, latest: true },
    { tag: 'v0.6.0', prerelease: true, latest: false }
  ];
  const before = structuredClone(history);
  const next = releaseEvidence.githubReleaseState({
    version: '0.7.0', tag: 'v0.7.0', channel: 'public_beta'
  });
  assert.deepEqual(history, before);
  assert.deepEqual(next, expectedPublicBeta);
  assert.equal(next.latest, false);
  assert.equal(next.prerelease, true);
});

function command(command, args, cwd, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8' });
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex');
}

test('verify-tag emits GitHub state only from the verified canonical signed payload', { skip: linuxGpgIntegration }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-signed-channel-'));
  const home = path.join(directory, 'gnupg');
  const repo = path.join(directory, 'repo');
  try {
    await mkdir(home, { mode: 0o700 });
    await mkdir(repo);
    let result = command('gpg', [
      '--batch', '--no-options', '--homedir', home,
      '--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-gen-key', 'Channel Test <channel@example.invalid>', 'ed25519', 'sign', '1d'
    ], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = command('gpg', ['--batch', '--no-options', '--homedir', home, '--with-colons', '--fingerprint', '--list-keys'], repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const fingerprint = result.stdout.split('\n').find((line) => line.startsWith('fpr:'))?.split(':')[9];
    assert.match(fingerprint, /^[0-9A-F]{40}$/);

    assert.equal(command('git', ['init', '-q'], repo).status, 0);
    await writeFile(path.join(repo, 'README.md'), 'fixture\n');
    assert.equal(command('git', ['add', 'README.md'], repo).status, 0);
    assert.equal(command('git', [
      '-c', 'user.name=Channel Test', '-c', 'user.email=channel@example.invalid',
      'commit', '-qm', 'fixture'
    ], repo).status, 0);
    const commit = command('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
    const tree = command('git', ['rev-parse', 'HEAD^{tree}'], repo).stdout.trim();
    const dist = path.join(repo, 'dist');
    await mkdir(dist);
    const names = [
      'zimster-0.7.0-claude.zip', 'zimster-0.7.0-codex.zip',
      'zimster-0.7.0-openai.zip', 'zimster-0.7.0-portable.zip', 'zimster-0.7.0.tgz'
    ];
    const artifacts = [];
    for (const name of names) {
      const data = Buffer.from(`fixture:${name}\n`);
      await writeFile(path.join(dist, name), data);
      artifacts.push({ name, sha256: digest(data), size: (await stat(path.join(dist, name))).size });
    }
    const inputs = {};
    const embeddedInputs = {};
    for (const [option, field] of [
      ['standards.json', 'standards_lock_sha256'],
      ['semantic.json', 'semantic_review_sha256'],
      ['hosts.json', 'host_matrix_sha256'],
      ['verification.json', 'verification_sha256']
    ]) {
      const data = Buffer.from(`{"fixture":"${option}"}\n`);
      await writeFile(path.join(repo, option), data);
      inputs[field] = digest(data);
      if (option !== 'standards.json') {
        const embeddedField = {
          'semantic.json': 'semantic_review_base64',
          'hosts.json': 'host_matrix_base64',
          'verification.json': 'verification_base64'
        }[option];
        embeddedInputs[embeddedField] = data.toString('base64');
      }
    }
    const evidence = {
      schema_version: 2,
      version: '0.7.0',
      tag: 'v0.7.0',
      channel: 'public_beta',
      commit,
      tree,
      ...inputs,
      embedded_inputs: embeddedInputs,
      artifacts
    };
    const message = path.join(repo, 'release-evidence.json');
    await writeFile(message, `${JSON.stringify(evidence, null, 2)}\n`);
    const signedEnv = { ...process.env, GNUPGHOME: home };
    result = command('git', [
      '-c', `user.signingkey=${fingerprint}`,
      '-c', 'user.name=Channel Test', '-c', 'user.email=channel@example.invalid',
      'tag', '-s', 'v0.7.0', '-F', message
    ], repo, signedEnv);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const file of ['semantic.json', 'hosts.json', 'verification.json']) {
      await rm(path.join(repo, file));
    }
    result = command(process.execPath, [
      path.join(root, 'scripts/release-evidence.mjs'), 'extract-tag',
      '--tag', 'v0.7.0', '--output-dir', 'release/evidence'
    ], repo, signedEnv);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'SIGNED_RELEASE_INPUTS_MATERIALIZED');

    const githubOutput = path.join(directory, 'github-output');
    result = command(process.execPath, [
      path.join(root, 'scripts/release-evidence.mjs'), 'verify-tag',
      '--tag', 'v0.7.0', '--trusted-fingerprint', fingerprint,
      '--standards-lock', 'standards.json', '--semantic-review', 'release/evidence/semantic-review.json',
      '--host-matrix', 'release/evidence/host-matrix.json', '--verification', 'release/evidence/verification.json',
      '--dist', 'dist', '--github-output', githubOutput
    ], repo, signedEnv);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.channel, 'public_beta');
    assert.deepEqual(receipt.github_release, expectedPublicBeta);
    assert.equal(await readFile(githubOutput, 'utf8'), [
      'release_channel=public_beta',
      'release_title=Zimster 0.7.0 - Public Beta',
      'release_prerelease=true',
      'release_latest=false',
      ''
    ].join('\n'));

    const rejectedOutput = path.join(directory, 'rejected-output');
    result = command(process.execPath, [
      path.join(root, 'scripts/release-evidence.mjs'), 'verify-tag',
      '--tag', 'v0.7.0', '--trusted-fingerprint', 'A'.repeat(40),
      '--standards-lock', 'standards.json', '--semantic-review', 'release/evidence/semantic-review.json',
      '--host-matrix', 'release/evidence/host-matrix.json', '--verification', 'release/evidence/verification.json',
      '--dist', 'dist', '--github-output', rejectedOutput
    ], repo, signedEnv);
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(rejectedOutput, 'utf8'), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
