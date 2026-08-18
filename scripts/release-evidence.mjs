import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import {
  decodeEmbeddedReleaseInputs,
  githubReleaseState,
  MAX_RELEASE_TAG_PAYLOAD_BYTES,
  normalizeReleaseSignerFingerprint,
  parseReleaseEvidenceTagPayload,
  RELEASE_EVIDENCE_INPUTS
} from './lib/release-evidence.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const artifactPattern = /^zimster-\d+\.\d+\.\d+(?:-(?:claude|codex|openai|portable))?(?:\.zip|\.tgz)$/;

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
  const optionByName = new Map([
    ['semantic-review.json', 'semantic-review'],
    ['host-matrix.json', 'host-matrix'],
    ['verification.json', 'verification']
  ]);
  return Object.fromEntries(await Promise.all(RELEASE_EVIDENCE_INPUTS.map(async ([name]) => {
    const bytes = await readFile(path.resolve(process.cwd(), required(options, optionByName.get(name))));
    return [name, bytes.toString('base64')];
  })));
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
    'verification_sha256', 'embedded_inputs', 'artifacts'
  ];
  if (evidence.schema_version !== 2) throw new Error('release evidence requires schema_version 2');
  if (!/^\d+\.\d+\.\d+$/.test(evidence.version) || evidence.tag !== `v${evidence.version}`) throw new Error('release version and tag must be matching strict semver');
  if (!['public_beta', 'stable'].includes(evidence.channel)) throw new Error('release channel must be public_beta or stable');
  assertHex(evidence.commit, 40, 'commit');
  assertHex(evidence.tree, 40, 'tree');
  for (const field of keys.filter((key) => key.endsWith('_sha256'))) assertHex(evidence[field], 64, field);
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length !== 5) throw new Error('release evidence must contain five artifacts');
  const expectedArtifactNames = [
    `zimster-${evidence.version}-claude.zip`,
    `zimster-${evidence.version}-codex.zip`,
    `zimster-${evidence.version}-openai.zip`,
    `zimster-${evidence.version}-portable.zip`,
    `zimster-${evidence.version}.tgz`
  ];
  for (const [index, artifact] of evidence.artifacts.entries()) {
    if (!artifact || Object.keys(artifact).some((key) => !['name', 'sha256', 'size'].includes(key))) {
      throw new Error('release artifact inventory contains unsupported fields');
    }
    if (artifact.name !== expectedArtifactNames[index]) throw new Error('release artifact inventory is not canonical');
    assertHex(artifact.sha256, 64, `artifact ${artifact.name} sha256`);
    if (!Number.isInteger(artifact.size) || artifact.size < 1) throw new Error(`artifact ${artifact.name} size must be positive`);
  }
  if (Object.keys(evidence).some((key) => !keys.includes(key))) throw new Error('release evidence contains unsupported fields');
  decodeEmbeddedReleaseInputs(evidence);
}

function gitOutput(root, args, label, maxBuffer = 1024 * 1024) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function assertCandidateObject(root, commit, tree) {
  const resolvedCommit = gitOutput(root, ['rev-parse', '--verify', `${commit}^{commit}`], 'release commit resolution');
  const resolvedTree = gitOutput(root, ['rev-parse', `${commit}^{tree}`], 'release tree resolution');
  if (resolvedCommit !== commit) throw new Error('release evidence commit must be the exact full candidate commit');
  if (resolvedTree !== tree) throw new Error('release evidence tree must match the exact candidate commit tree');
}

function verifiedTagEvidence(root, tag, fingerprint) {
  if (gitOutput(root, ['cat-file', '-t', tag], 'release tag type') !== 'tag') {
    throw new Error('release authorization requires an annotated tag object');
  }
  const signature = spawnSync('git', ['verify-tag', '--raw', tag], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_RELEASE_TAG_PAYLOAD_BYTES + 1024 * 1024
  });
  if (signature.status !== 0) throw new Error(`tag signature verification failed: ${signature.stderr || signature.stdout}`);
  const validFingerprint = `${signature.stderr}\n${signature.stdout}`.match(/VALIDSIG\s+([0-9A-F]{40,64})/i)?.[1]?.toUpperCase();
  if (!validFingerprint || validFingerprint !== fingerprint) throw new Error('tag signer fingerprint is not the configured release signer');
  const commit = gitOutput(root, ['rev-list', '-n', '1', tag], 'release tag commit');
  const tree = gitOutput(root, ['rev-parse', `${tag}^{tree}`], 'release tag tree');
  const contents = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents)'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_RELEASE_TAG_PAYLOAD_BYTES + 1024 * 1024
  });
  const detachedSignature = spawnSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(contents:signature)'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (contents.status !== 0 || detachedSignature.status !== 0) {
    throw new Error(`signed tag content inspection failed: ${contents.stderr || detachedSignature.stderr}`);
  }
  if (!detachedSignature.stdout.includes('-----BEGIN PGP SIGNATURE-----') || !contents.stdout.endsWith(detachedSignature.stdout)) {
    throw new Error('signed tag contents do not end with exactly one detached OpenPGP signature');
  }
  const evidence = parseReleaseEvidenceTagPayload(contents.stdout.slice(0, -detachedSignature.stdout.length));
  validateShape(evidence);
  if (evidence.tag !== tag) throw new Error('tag does not match release evidence');
  if (evidence.commit !== commit) throw new Error('commit does not match release evidence');
  if (evidence.tree !== tree) throw new Error('tree does not match release evidence');
  return { evidence, commit, tree, validFingerprint };
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
  assertCandidateObject(findRepoRoot(process.cwd()), evidence.commit, evidence.tree);
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
  const fingerprint = normalizeReleaseSignerFingerprint(required(options, 'trusted-fingerprint'));
  const { evidence, commit, tree } = verifiedTagEvidence(root, tag, fingerprint);
  const decoded = decodeEmbeddedReleaseInputs(evidence);
  const output = path.resolve(process.cwd(), required(options, 'output'));
  await mkdir(output, { mode: 0o700 });
  await Promise.all([...decoded].map(([name, bytes]) => writeFile(path.join(output, name), bytes, {
    flag: 'wx', mode: 0o600
  })));
  writeLine(JSON.stringify({
    status: 'SIGNED_RELEASE_INPUTS_MATERIALIZED', tag, commit, tree,
    output, files: [...decoded.keys()]
  }));
} else if (action === 'verify-tag') {
  const root = findRepoRoot(process.cwd());
  const tag = required(options, 'tag');
  const fingerprint = normalizeReleaseSignerFingerprint(required(options, 'trusted-fingerprint'));
  const { evidence, commit, tree, validFingerprint } = verifiedTagEvidence(root, tag, fingerprint);
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
