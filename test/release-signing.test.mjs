import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const helper = path.join(root, '.github/scripts/release-signing-key.mjs');
const linuxGpgIntegration = process.platform === 'linux'
  ? false
  : 'Cryptographic integration targets the Linux release runner; macOS and Windows continue to exercise the platform-independent release contract.';

function gpg(home, args, options = {}) {
  return spawnSync('gpg', ['--batch', '--no-options', '--homedir', home, ...args], {
    encoding: options.encoding ?? 'utf8',
    input: options.input
  });
}

function primaryFingerprint(home) {
  const result = gpg(home, ['--with-colons', '--fingerprint', '--list-keys']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.split('\n');
  const pub = lines.findIndex((line) => line.startsWith('pub:'));
  return lines.slice(pub + 1).find((line) => line.startsWith('fpr:'))?.split(':')[9];
}

async function generatedKey(directory, identity) {
  const home = path.join(directory, identity.replaceAll(/[^a-z]/gi, '-'));
  await mkdir(home, { mode: 0o700 });
  const generated = gpg(home, [
    '--pinentry-mode', 'loopback', '--passphrase', '',
    '--quick-gen-key', `${identity} <${identity.toLowerCase()}@example.invalid>`,
    'ed25519', 'sign', '1d'
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const fingerprint = primaryFingerprint(home);
  assert.match(fingerprint, /^[0-9A-F]{40}$/);
  const exported = gpg(home, ['--armor', '--export', fingerprint]);
  assert.equal(exported.status, 0, exported.stderr || exported.stdout);
  return { home, fingerprint, publicKey: exported.stdout };
}

function runHelper(args) {
  return spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: 'utf8' });
}

async function emptyHome(directory, name) {
  const home = path.join(directory, name);
  await mkdir(home, { mode: 0o700 });
  return home;
}

test('release signing helper derives, matches, and only then imports one public primary key', { skip: linuxGpgIntegration }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-release-key-'));
  try {
    const generated = await generatedKey(directory, 'Release Test');
    const key = path.join(directory, 'release.asc');
    const target = await emptyHome(directory, 'target');
    await writeFile(key, generated.publicKey);
    const result = runHelper([
      '--key', key,
      '--trusted-fingerprint', generated.fingerprint.toLowerCase().match(/.{1,4}/g).join(' '),
      '--gnupg-home', target
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'RELEASE_SIGNING_KEY_IMPORTED',
      fingerprint: generated.fingerprint
    });
    assert.equal(primaryFingerprint(target), generated.fingerprint);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a mismatching trust anchor fails before the public key is imported', { skip: linuxGpgIntegration }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-release-key-mismatch-'));
  try {
    const generated = await generatedKey(directory, 'Mismatch Test');
    const key = path.join(directory, 'release.asc');
    const target = await emptyHome(directory, 'target');
    await writeFile(key, generated.publicKey);
    const result = runHelper([
      '--key', key,
      '--trusted-fingerprint', 'A'.repeat(40),
      '--gnupg-home', target
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fingerprint.*configured|trust anchor/i);
    const listing = gpg(target, ['--with-colons', '--list-keys']);
    assert.doesNotMatch(listing.stdout, /^pub:/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ambiguous or secret key material is rejected without importing a key', { skip: linuxGpgIntegration }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-release-key-invalid-'));
  try {
    const first = await generatedKey(directory, 'First Test');
    const second = await generatedKey(directory, 'Second Test');
    const ambiguous = path.join(directory, 'ambiguous.asc');
    const ambiguousTarget = await emptyHome(directory, 'ambiguous-target');
    await writeFile(ambiguous, `${first.publicKey}${second.publicKey}`);
    let result = runHelper([
      '--key', ambiguous,
      '--trusted-fingerprint', first.fingerprint,
      '--gnupg-home', ambiguousTarget
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one.*primary/i);
    assert.doesNotMatch(gpg(ambiguousTarget, ['--with-colons', '--list-keys']).stdout, /^pub:/m);

    const secret = path.join(directory, 'secret.asc');
    const secretTarget = await emptyHome(directory, 'secret-target');
    const exportedSecret = gpg(first.home, [
      '--pinentry-mode', 'loopback', '--passphrase', '', '--armor', '--export-secret-keys', first.fingerprint
    ]);
    assert.equal(exportedSecret.status, 0, exportedSecret.stderr || exportedSecret.stdout);
    await writeFile(secret, exportedSecret.stdout);
    result = runHelper([
      '--key', secret,
      '--trusted-fingerprint', first.fingerprint,
      '--gnupg-home', secretTarget
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /secret|private/i);
    assert.doesNotMatch(gpg(secretTarget, ['--with-colons', '--list-keys']).stdout, /^pub:/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the checked-in owner public key resolves to the configured release fingerprint', { skip: linuxGpgIntegration }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-owner-release-key-'));
  try {
    const result = runHelper([
      '--key', path.join(root, '.github/release-keys/william-zimmerman.asc'),
      '--trusted-fingerprint', '4C099B5F3C4AC592ED6B82A7D8EF38626D2B8ECF',
      '--gnupg-home', await emptyHome(directory, 'target')
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).fingerprint, '4C099B5F3C4AC592ED6B82A7D8EF38626D2B8ECF');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
