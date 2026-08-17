import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { evaluateCoherence } from './lib/coherence-preflight.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  githubReleaseState,
  normalizeReleaseSignerFingerprint,
  parseReleaseEvidenceTagPayload
} from './lib/release-evidence.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const artifactPattern = /^zimster-\d+\.\d+\.\d+(?:-(?:claude|codex|openai|portable))?(?:\.zip|\.tgz)$/;
const embeddedInputOptions = Object.freeze([
  ['semantic_review_base64', 'semantic-review', 'semantic-review.json'],
  ['host_matrix_base64', 'host-matrix', 'host-matrix.json'],
  ['verification_base64', 'verification', 'verification.json']
]);
const maximumEmbeddedInputBytes = 1024 * 1024;

async function digestFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function inputDigests() {
  const rows = [
    ['standards_lock_sha256', 'standards-lock'],
    ['semantic_review_sha256', 'semantic-review'],
    ['host_matrix_sha256', 'host-matrix'],
    ['verification_sha256', 'verification']
  ];
  return Object.fromEntries(await Promise.all(rows.map(async ([field, option]) => [
    field,
    await digestFile(path.resolve(process.cwd(), required(options, option)))
  ])));
}

async function embeddedInputs() {
  return Object.fromEntries(await Promise.all(embeddedInputOptions.map(async ([field, option]) => {
    const contents = await readFile(path.resolve(process.cwd(), required(options, option)));
    if (contents.length > maximumEmbeddedInputBytes) {
      throw new Error(`${option} exceeds the ${maximumEmbeddedInputBytes}-byte signed-tag input limit`);
    }
    return [field, contents.toString('base64')];
  })));
}

function decodeEmbeddedInputs(evidence) {
  if (evidence.schema_version !== 2) {
    throw new Error('release evidence schema_version 2 is required to materialize signed inputs');
  }
  const expectedFields = embeddedInputOptions.map(([field]) => field).sort();
  const actualFields = Object.keys(evidence.embedded_inputs || {}).sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    throw new Error('release evidence embedded_inputs has an invalid inventory');
  }
  return Object.fromEntries(embeddedInputOptions.map(([field, option, filename]) => {
    const encoded = evidence.embedded_inputs[field];
    if (typeof encoded !== 'string' || !encoded.length) {
      throw new Error(`${field} must be non-empty canonical base64`);
    }
    const contents = Buffer.from(encoded, 'base64');
    if (contents.length > maximumEmbeddedInputBytes || contents.toString('base64') !== encoded) {
      throw new Error(`${field} must be canonical base64 within the signed-tag input limit`);
    }
    return [option, { filename, contents }];
  }));
}

function verifyEmbeddedInputDigests(evidence) {
  if (evidence.schema_version !== 2) return;
  const decoded = decodeEmbeddedInputs(evidence);
  for (const [field, option] of [
    ['semantic_review_sha256', 'semantic-review'],
    ['host_matrix_sha256', 'host-matrix'],
    ['verification_sha256', 'verification']
  ]) {
    const digest = createHash('sha256').update(decoded[option].contents).digest('hex');
    if (evidence[field] !== digest) throw new Error(`${option.replace('-', ' ')} embedded digest mismatch`);
  }
  return decoded;
}

async function artifacts(dist, version) {
  const result = [];
  for (const name of (await readdir(dist)).sort()) {
    if (!artifactPattern.test(name) || !name.startsWith(`zimster-${version}`)) continue;
    const file = path.join(dist, name);
    const metadata = await stat(file);
    if (metadata.isFile()) result.push({ name, sha256: await digestFile(file), size: metadata.size });
  }
  if (result.length !== 5) throw new Error(`release evidence requires exactly five ${version} artifacts; found ${result.length}`);
  return result;
}

function assertHex(value, length, field) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(String(value || ''))) throw new Error(`${field} must be ${length} lowercase hex characters`);
}

function validateShape(evidence) {
  const keys = [
    'schema_version', 'version', 'tag', 'channel', 'commit', 'tree',
    'standards_lock_sha256', 'semantic_review_sha256', 'host_matrix_sha256',
    'verification_sha256', 'artifacts'
  ];
  if (![1, 2].includes(evidence.schema_version)) throw new Error('release evidence requires schema_version 1 or 2');
  if (evidence.schema_version === 2) keys.push('embedded_inputs');
  if (!/^\d+\.\d+\.\d+$/.test(evidence.version) || evidence.tag !== `v${evidence.version}`) throw new Error('release version and tag must be matching strict semver');
  if (!['public_beta', 'stable'].includes(evidence.channel)) throw new Error('release channel must be public_beta or stable');
  assertHex(evidence.commit, 40, 'commit');
  assertHex(evidence.tree, 40, 'tree');
  for (const field of keys.filter((key) => key.endsWith('_sha256'))) assertHex(evidence[field], 64, field);
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length !== 5) throw new Error('release evidence must contain five artifacts');
  if (Object.keys(evidence).some((key) => !keys.includes(key))) throw new Error('release evidence contains unsupported fields');
  verifyEmbeddedInputDigests(evidence);
}

async function verifyEvidence(evidence) {
  validateShape(evidence);
  if (options['expected-tag'] && evidence.tag !== String(options['expected-tag'])) throw new Error('tag does not match release evidence');
  if (options['expected-commit'] && evidence.commit !== String(options['expected-commit'])) throw new Error('commit does not match release evidence');
  if (options['expected-tree'] && evidence.tree !== String(options['expected-tree'])) throw new Error('tree does not match release evidence');
  const expectedInputs = await inputDigests();
  for (const [field, digest] of Object.entries(expectedInputs)) {
    if (evidence[field] !== digest) throw new Error(`${field.replace('_sha256', '').replaceAll('_', ' ')} digest mismatch`);
  }
  const actualArtifacts = await artifacts(path.resolve(process.cwd(), required(options, 'dist')), evidence.version);
  if (JSON.stringify(evidence.artifacts) !== JSON.stringify(actualArtifacts)) throw new Error('artifact digest or inventory mismatch');
  return evidence;
}

if (action === 'create') {
  const root = findRepoRoot(process.cwd());
  const coherence = await evaluateCoherence(await ensureRuntimeDirectory(root), root, {
    operation: 'release',
    seamId: options['seam-id'] ? String(options['seam-id']) : 'whole-release'
  });
  if (coherence.status !== 'COHERENCE_CURRENT') {
    throw new Error(`COHERENCE_BLOCKED: ${coherence.issues.join('; ')}`);
  }
  const candidate = await captureGitState(root);
  if (required(options, 'commit') !== candidate.head || required(options, 'tree') !== candidate.tree) {
    throw new Error('release evidence commit/tree must bind the exact coherent candidate checkout');
  }
  const version = required(options, 'version');
  const evidence = {
    schema_version: 2,
    version,
    tag: required(options, 'tag'),
    channel: required(options, 'channel'),
    commit: required(options, 'commit'),
    tree: required(options, 'tree'),
    ...await inputDigests(),
    embedded_inputs: await embeddedInputs(),
    artifacts: await artifacts(path.resolve(process.cwd(), required(options, 'dist')), version)
  };
  validateShape(evidence);
  const output = path.resolve(process.cwd(), required(options, 'output'));
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  writeLine(output);
} else if (action === 'verify') {
  const evidence = JSON.parse(await readFile(path.resolve(process.cwd(), required(options, 'file')), 'utf8'));
  await verifyEvidence(evidence);
  writeLine(JSON.stringify({ status: 'RELEASE_EVIDENCE_VERIFIED', tag: evidence.tag, artifacts: evidence.artifacts.length }));
} else if (action === 'extract-tag') {
  const root = findRepoRoot(process.cwd());
  const tag = required(options, 'tag');
  const contents = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents)'], { cwd: root, encoding: 'utf8' });
  const detachedSignature = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents:signature)'], { cwd: root, encoding: 'utf8' });
  if (contents.status !== 0 || detachedSignature.status !== 0) {
    throw new Error(`signed tag content inspection failed: ${contents.stderr || detachedSignature.stderr}`);
  }
  if (!detachedSignature.stdout.includes('-----BEGIN PGP SIGNATURE-----') || !contents.stdout.endsWith(detachedSignature.stdout)) {
    throw new Error('signed tag contents do not end with exactly one detached OpenPGP signature');
  }
  const evidence = parseReleaseEvidenceTagPayload(contents.stdout.slice(0, -detachedSignature.stdout.length));
  validateShape(evidence);
  const decoded = verifyEmbeddedInputDigests(evidence);
  const outputDirectory = path.resolve(process.cwd(), required(options, 'output-dir'));
  await mkdir(outputDirectory, { recursive: true });
  for (const { filename, contents: inputContents } of Object.values(decoded)) {
    await writeFile(path.join(outputDirectory, filename), inputContents);
  }
  writeLine(JSON.stringify({ status: 'SIGNED_RELEASE_INPUTS_MATERIALIZED', tag, output_directory: outputDirectory }));
} else if (action === 'verify-tag') {
  const root = findRepoRoot(process.cwd());
  const tag = required(options, 'tag');
  const fingerprint = normalizeReleaseSignerFingerprint(required(options, 'trusted-fingerprint'));
  const signature = spawnSync('git', ['verify-tag', '--raw', tag], { cwd: root, encoding: 'utf8' });
  if (signature.status !== 0) throw new Error(`tag signature verification failed: ${signature.stderr || signature.stdout}`);
  const validFingerprint = `${signature.stderr}\n${signature.stdout}`.match(/VALIDSIG\s+([0-9A-F]{40,64})/i)?.[1]?.toUpperCase();
  if (!validFingerprint || validFingerprint !== fingerprint) throw new Error('tag signer fingerprint is not the configured release signer');
  const commit = spawnSync('git', ['rev-list', '-n', '1', tag], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const tree = spawnSync('git', ['rev-parse', `${tag}^{tree}`], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const contents = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents)'], { cwd: root, encoding: 'utf8' });
  const detachedSignature = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents:signature)'], { cwd: root, encoding: 'utf8' });
  if (contents.status !== 0 || detachedSignature.status !== 0) {
    throw new Error(`signed tag content inspection failed: ${contents.stderr || detachedSignature.stderr}`);
  }
  if (!detachedSignature.stdout.includes('-----BEGIN PGP SIGNATURE-----') || !contents.stdout.endsWith(detachedSignature.stdout)) {
    throw new Error('signed tag contents do not end with exactly one detached OpenPGP signature');
  }
  const evidence = parseReleaseEvidenceTagPayload(contents.stdout.slice(0, -detachedSignature.stdout.length));
  options['expected-tag'] = tag;
  options['expected-commit'] = commit;
  options['expected-tree'] = tree;
  await verifyEvidence(evidence);
  const githubRelease = githubReleaseState(evidence);
  if (options['github-output']) {
    const output = path.resolve(process.cwd(), String(options['github-output']));
    await appendFile(output, [
      `release_channel=${githubRelease.channel}`,
      `release_title=${githubRelease.title}`,
      `release_prerelease=${githubRelease.prerelease}`,
      `release_latest=${githubRelease.latest}`,
      ''
    ].join('\n'));
  }
  writeLine(JSON.stringify({
    status: 'SIGNED_RELEASE_AUTHORIZATION_VERIFIED',
    tag,
    commit,
    tree,
    signer: validFingerprint,
    channel: evidence.channel,
    github_release: githubRelease
  }));
} else {
  throw new Error('Usage: release-evidence.mjs <create|verify|extract-tag|verify-tag> [options]');
}
