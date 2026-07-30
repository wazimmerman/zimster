import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathFromIdentity } from './path-identity.mjs';

export function fingerprintJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function inputDigest(absolute, seen = new Set()) {
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    const target = await readlink(absolute);
    let resolved;
    try {
      resolved = await realpath(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') return `symlink:${target}:missing`;
      throw error;
    }
    return `symlink:${target}:${await inputDigest(resolved, seen)}`;
  }
  if (metadata.isFile()) {
    return `file:${createHash('sha256').update(await readFile(absolute)).digest('hex')}`;
  }
  if (metadata.isDirectory()) {
    const canonical = await realpath(absolute);
    if (seen.has(canonical)) return `cycle:${canonical}`;
    const nextSeen = new Set(seen).add(canonical);
    const hash = createHash('sha256');
    for (const name of (await readdir(absolute)).sort()) {
      hash.update(`${name}\0${await inputDigest(path.join(absolute, name), nextSeen)}\0`);
    }
    return `directory:${hash.digest('hex')}`;
  }
  return `other:${metadata.mode}:${metadata.size}`;
}

export async function fingerprintInputs(inputs, cwd = process.cwd()) {
  return Promise.all(inputs.map(async (input) => ({
    input,
    digest: await inputDigest(path.resolve(cwd, input))
  })));
}

export async function fingerprintPathIdentities(root, identities) {
  return Promise.all(identities.map(async (input) => ({
    input,
    digest: await inputDigest(pathFromIdentity(root, input))
  })));
}

function sameList(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

export async function evidenceStalenessReason(receipt, {
  root,
  state,
  environment = null,
  requested = {}
}) {
  if (environment) {
    if (
      receipt.environment_fingerprint
      && receipt.environment_fingerprint !== fingerprintJson(environment)
    ) {
      return 'environment fingerprint changed';
    }
    for (const key of ['platform', 'release', 'arch', 'node', 'npm', 'host_version']) {
      if ((receipt.environment?.[key] ?? null) !== environment[key]) {
        return `environment.${key} changed`;
      }
    }
  }
  if (
    requested.dependencies
    && !sameList(receipt.dependency_cone, requested.dependencies)
  ) {
    return 'declared dependency cone changed';
  }
  if (requested.inputs && !sameList(receipt.inputs, requested.inputs)) {
    return 'declared inputs changed';
  }
  const recordedInputs = receipt.input_fingerprints;
  if (!Array.isArray(recordedInputs) || recordedInputs.length !== (receipt.inputs || []).length) {
    if ((receipt.inputs || []).length) return 'input fingerprints are unavailable';
  } else {
    const currentInputs = receipt.path_identity_format === 'canonical-v1'
      ? await fingerprintPathIdentities(root, receipt.inputs || [])
      : await fingerprintInputs(
        receipt.inputs || [],
        path.resolve(root, receipt.cwd || '.')
      );
    for (let index = 0; index < recordedInputs.length; index += 1) {
      if (
        recordedInputs[index]?.input !== currentInputs[index].input
        || recordedInputs[index]?.digest !== currentInputs[index].digest
      ) return `input ${currentInputs[index].input} changed`;
    }
  }
  const recordedDependencies = receipt.dependency_fingerprints;
  if ((receipt.dependency_cone || []).length) {
    if (
      !Array.isArray(recordedDependencies)
      || recordedDependencies.length !== receipt.dependency_cone.length
    ) {
      return 'dependency fingerprints are unavailable';
    }
    const currentDependencies = receipt.path_identity_format === 'canonical-v1'
      ? await fingerprintPathIdentities(root, receipt.dependency_cone)
      : await fingerprintInputs(receipt.dependency_cone, root);
    for (let index = 0; index < recordedDependencies.length; index += 1) {
      if (
        recordedDependencies[index]?.input !== currentDependencies[index].input
        || recordedDependencies[index]?.digest !== currentDependencies[index].digest
      ) return `dependency ${currentDependencies[index].input} changed`;
    }
  } else if (state.tree !== receipt.git_tree) {
    return 'immutable Git tree changed';
  }
  if (receipt.dirty_tree_fingerprint) {
    if (state.dirty_tree_fingerprint !== receipt.dirty_tree_fingerprint) {
      return 'dirty tree changed';
    }
  } else if (state.working_tree_hash !== receipt.working_tree_hash) {
    return 'working tree changed';
  }
  return null;
}
