import { mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseOptions, required, writeLine } from '../../scripts/lib/cli.mjs';
import { normalizeReleaseSignerFingerprint } from '../../scripts/lib/release-evidence.mjs';

const { options } = parseOptions(process.argv.slice(2));
const keyFile = path.resolve(process.cwd(), required(options, 'key'));
const trustedFingerprint = normalizeReleaseSignerFingerprint(required(options, 'trusted-fingerprint'));
const gnupgHome = path.resolve(process.cwd(), required(options, 'gnupg-home'));

const keyMetadata = await stat(keyFile);
if (!keyMetadata.isFile()) throw new Error('release public-key path must identify a regular file');
await mkdir(gnupgHome, { recursive: true, mode: 0o700 });

function gpg(args, description) {
  const result = spawnSync('gpg', [
    '--batch', '--no-options', '--homedir', gnupgHome, ...args
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${description} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function publicPrimaryFingerprints(colonOutput) {
  const primary = [];
  let awaitingPrimaryFingerprint = false;
  let publicKeys = 0;
  let identities = 0;
  for (const line of String(colonOutput).split('\n')) {
    const fields = line.split(':');
    if (fields[0] === 'pub') {
      publicKeys += 1;
      awaitingPrimaryFingerprint = true;
    } else if (fields[0] === 'fpr' && awaitingPrimaryFingerprint) {
      primary.push(normalizeReleaseSignerFingerprint(fields[9]));
      awaitingPrimaryFingerprint = false;
    } else if (fields[0] === 'sub') {
      awaitingPrimaryFingerprint = false;
    } else if (fields[0] === 'uid') {
      identities += 1;
    } else if (fields[0] === 'sec' || fields[0] === 'ssb') {
      throw new Error('release key file must not contain secret or private key material');
    }
  }
  if (publicKeys !== 1 || primary.length !== 1) {
    throw new Error('release key file must contain exactly one OpenPGP public primary key');
  }
  if (identities < 1) throw new Error('release public key must contain at least one identity');
  return primary;
}

const packets = gpg(['--list-packets', keyFile], 'OpenPGP packet inspection');
if (/^:secret (?:sub )?key packet:/m.test(packets.stdout)) {
  throw new Error('release key file must not contain secret or private key material');
}

const inspected = gpg([
  '--with-colons', '--import-options', 'show-only', '--import', keyFile
], 'OpenPGP public-key inspection');
const [derivedFingerprint] = publicPrimaryFingerprints(inspected.stdout);
if (derivedFingerprint !== trustedFingerprint) {
  throw new Error('public-key fingerprint does not match the configured release signer trust anchor');
}

gpg(['--import', keyFile], 'OpenPGP public-key import');
const imported = gpg([
  '--with-colons', '--fingerprint', '--list-keys', trustedFingerprint
], 'imported public-key verification');
const [importedFingerprint] = publicPrimaryFingerprints(imported.stdout);
if (importedFingerprint !== trustedFingerprint) {
  throw new Error('imported public key does not match the configured release signer trust anchor');
}

writeLine(JSON.stringify({
  status: 'RELEASE_SIGNING_KEY_IMPORTED',
  fingerprint: trustedFingerprint
}));
