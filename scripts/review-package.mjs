import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import {
  captureGitState,
  findRepoRoot,
  gitValue,
  runGit,
  untrackedFiles
} from './lib/git-state.mjs';
import { evidenceStalenessReason } from './lib/evidence-validity.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  selectSemanticLenses,
  semanticContractDigest
} from './lib/semantic-assurance.mjs';
import { REVIEW_ATTEMPT_TYPES } from './lib/review-lifecycle.mjs';

const { options } = parseOptions(process.argv.slice(2));
const root = findRepoRoot(process.cwd());
const head = String(options.head || gitValue(['rev-parse', 'HEAD'], root, '')).toLowerCase();
const defaultBase = gitValue(['merge-base', 'origin/main', head], root, null)
  || gitValue(['rev-parse', `${head}^`], root, head);
const base = String(options.base || defaultBase || '').toLowerCase();
const attemptType = required(options, 'attempt-type');
const attemptId = required(options, 'attempt-id');
const seamId = required(options, 'seam-id');
if (!REVIEW_ATTEMPT_TYPES.includes(attemptType)) {
  throw new Error(`--attempt-type must be one of ${REVIEW_ATTEMPT_TYPES.join(', ')}`);
}
for (const [name, value] of [['attempt-id', attemptId], ['seam-id', seamId]]) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`--${name} must be a stable safe identifier`);
  }
}

function immutableCommit(name, value) {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`--${name} must be an immutable 40-character SHA`);
  }
  const result = runGit(['cat-file', '-e', `${value}^{commit}`], root, { allowFailure: true });
  if (result.status !== 0) throw new Error(`--${name} is not a commit in this repository`);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function listOption(name) {
  if (!options[name]) return [];
  const value = String(options[name]).trim();
  if (value.startsWith('[')) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) {
      throw new Error(`--${name} must be a comma-separated list or JSON array of strings`);
    }
    return parsed;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function fileAt(commit, relative) {
  const result = runGit(['show', `${commit}:${relative}`], root, {
    allowFailure: true,
    encoding: 'buffer'
  });
  return result.status === 0 ? Buffer.from(result.stdout) : null;
}

immutableCommit('base', base);
immutableCommit('head', head);
const currentState = await captureGitState(root);
const cleanFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const candidateCheckout = {
  head,
  tree: gitValue(['rev-parse', `${head}^{tree}`], root, null),
  dirty_tree_fingerprint: currentState.head === head
    ? currentState.dirty_tree_fingerprint
    : cleanFingerprint,
  current_checkout_observed: currentState.head === head
};
const dirtyTrackedPatch = currentState.head === head
  ? Buffer.from(runGit([
      'diff', '--binary', '--no-ext-diff', '--no-color', head
    ], root, { encoding: 'buffer' }).stdout)
  : Buffer.alloc(0);
const dirtyUntrackedFiles = [];
if (currentState.head === head) {
  for (const relative of untrackedFiles(root)) {
    const absolute = path.join(root, ...relative.split('/'));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute);
      dirtyUntrackedFiles.push({
        path: relative,
        kind: 'symlink',
        mode: metadata.mode,
        target,
        sha256: sha256(Buffer.from(target))
      });
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`dirty review package cannot reconstruct non-file untracked path: ${relative}`);
    }
    const data = await readFile(absolute);
    dirtyUntrackedFiles.push({
      path: relative,
      kind: 'file',
      mode: metadata.mode,
      bytes: data.length,
      sha256: sha256(data),
      content_base64: data.toString('base64')
    });
  }
}
const changed = runGit(['diff', '--name-only', '-z', `${base}..${head}`], root, {
  encoding: 'buffer'
}).stdout.toString('utf8').split('\0').filter(Boolean).sort();
const changedSet = new Set(changed);
const authoritative = [];
const generated = [];

for (const relative of changed) {
  const data = fileAt(head, relative);
  if (relative.startsWith('plugins/zimster/')) {
    const canonicalPath = relative.slice('plugins/zimster/'.length);
    const canonicalData = fileAt(head, canonicalPath);
    if (canonicalData !== null) {
      generated.push({
        path: relative,
        canonical_path: canonicalPath,
        sha256: data === null ? null : sha256(data),
        canonical_sha256: sha256(canonicalData),
        synchronized: data !== null && Buffer.compare(data, canonicalData) === 0
      });
      continue;
    }
  }
  authoritative.push({
    path: relative,
    status: data === null ? 'deleted' : 'present',
    bytes: data?.length ?? 0,
    sha256: data === null ? null : sha256(data)
  });
}

const interfaces = [];
for (const relative of listOption('interfaces')) {
  if (changedSet.has(relative)) {
    throw new Error(`relevant unchanged interface is changed in the review range: ${relative}`);
  }
  const data = fileAt(head, relative);
  if (data === null) throw new Error(`relevant unchanged interface is absent at head: ${relative}`);
  interfaces.push({ path: relative, bytes: data.length, sha256: sha256(data) });
}

let requirements = null;
if (options.requirements) {
  const requirementsPath = path.resolve(process.cwd(), String(options.requirements));
  const data = await readFile(requirementsPath);
  const text = data.toString('utf8').replace(/\s+/g, ' ').trim();
  requirements = {
    path: requirementsPath,
    bytes: data.length,
    sha256: sha256(data),
    digest: text.length > 512 ? `${text.slice(0, 509)}...` : text
  };
}

async function semanticFile(option) {
  if (!options[option]) return null;
  const file = path.resolve(process.cwd(), String(options[option]));
  const data = await readFile(file);
  return {
    path: file,
    bytes: data.length,
    sha256: sha256(data),
    value: JSON.parse(data.toString('utf8'))
  };
}

const bindingFile = await semanticFile('binding-requirements');
const matrixFile = await semanticFile('matrix');
let bindingRequirements = null;
let requirementMatrix = null;
if (bindingFile) {
  const requirementIds = (bindingFile.value.requirements || []).map(({ id }) => id);
  if (new Set(requirementIds).size !== requirementIds.length) {
    throw new Error('binding requirements contain duplicate IDs');
  }
  for (const id of requirementIds) {
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]{3,}$/.test(id)) {
      throw new Error(`binding requirements contain malformed ID ${id}`);
    }
  }
  bindingRequirements = {
    path: bindingFile.path,
    bytes: bindingFile.bytes,
    sha256: bindingFile.sha256,
    source: bindingFile.value.source || null,
    requirement_ids: requirementIds
  };
}
if (matrixFile) {
  const matrix = matrixFile.value;
  if (matrix.candidate_head !== head) {
    throw new Error(`requirement matrix candidate_head ${matrix.candidate_head} differs from review head ${head}`);
  }
  const headTree = gitValue(['rev-parse', `${head}^{tree}`], root, null);
  if (matrix.candidate_tree !== headTree) {
    throw new Error(`requirement matrix candidate_tree ${matrix.candidate_tree} differs from review head tree ${headTree}`);
  }
  const requirementIds = (matrix.requirements || []).map(({ id }) => id);
  if (
    bindingRequirements
    && JSON.stringify([...requirementIds].sort())
      !== JSON.stringify([...bindingRequirements.requirement_ids].sort())
  ) {
    throw new Error('requirement matrix IDs differ from the binding requirement set');
  }
  requirementMatrix = {
    path: matrixFile.path,
    bytes: matrixFile.bytes,
    sha256: matrixFile.sha256,
    candidate_head: matrix.candidate_head,
    candidate_tree: matrix.candidate_tree,
    requirement_ids: requirementIds,
    statuses: Object.fromEntries(
      [...new Set((matrix.requirements || []).map(({ status }) => status))]
        .sort()
        .map((status) => [
          status,
          matrix.requirements.filter((entry) => entry.status === status).length
        ])
    )
  };
}
const semanticContract = bindingFile && matrixFile
  ? {
      schema_version: 1,
      sha256: semanticContractDigest({
        bindingRequirements: bindingFile.value.requirements,
        matrix: matrixFile.value
      })
    }
  : null;
const riskSignals = listOption('risk-signals');
const lenses = [...new Set([
  ...listOption('lenses'),
  ...selectSemanticLenses(riskSignals)
])];
const intendedAcceptanceClaims = listOption('intended-claims');
const unavailableProof = listOption('unavailable-proof');
const requestedCompletionState = String(options['requested-state'] || 'PARTIALLY_VERIFIED');
const runtime = await ensureRuntimeDirectory(root);
let evidence = [];
try {
  const rows = (await readFile(path.join(runtime, 'evidence', 'receipts.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const invalidated = new Map(
    rows.filter((row) => row.record_type === 'invalidation')
      .map((row) => [row.receipt_id, row.reason])
  );
  const receipts = rows.filter((row) => row.record_type !== 'invalidation');
  const referencedIds = new Set(
    (matrixFile?.value.requirements || []).flatMap((entry) => entry.evidence_refs || [])
  );
  const selected = new Map(
    receipts
      .filter((row) => referencedIds.has(row.id))
      .map((row) => [row.id, row])
  );
  for (const row of receipts.slice(-20)) selected.set(row.id, row);
  const currentState = await captureGitState(root);
  evidence = await Promise.all([...selected.values()].map(async (row) => {
    const naturalReason = row.exit_code === 0
      ? await evidenceStalenessReason(row, { root, state: currentState })
      : null;
    const explicitReason = invalidated.get(row.id) || null;
    const freshnessReason = explicitReason || naturalReason;
    return {
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      exit_code: row.exit_code,
      git_commit: row.git_commit || row.git_head,
      git_tree: row.git_tree || null,
      working_tree_hash: row.working_tree_hash || null,
      dirty_tree_fingerprint: row.dirty_tree_fingerprint || null,
      dependency_cone: row.dependency_cone || [],
      dependency_fingerprints: row.dependency_fingerprints || [],
      dependency_freshness: {
        status: freshnessReason ? 'stale' : row.exit_code === 0 ? 'fresh' : 'failed',
        reason: freshnessReason
      },
      status: freshnessReason
        ? 'stale'
        : row.exit_code === 0 ? 'recorded_pass' : 'recorded_fail',
      requirement_ids: row.requirement_ids || [],
      establishes: row.establishes || [],
      does_not_establish: row.does_not_establish || [],
      environment_scope: row.environment_scope || null,
      ...(explicitReason ? { invalidation_reason: explicitReason } : {}),
      ...(naturalReason ? { natural_staleness_reason: naturalReason } : {})
    };
  }));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const identity = sha256(JSON.stringify({
  attempt_type: attemptType,
  attempt_id: attemptId,
  seam_id: seamId,
  base,
  head,
  candidate_checkout: candidateCheckout,
  requirements: requirements?.sha256 || null,
  binding_requirements: bindingRequirements?.sha256 || null,
  requirement_matrix: requirementMatrix?.sha256 || null,
  semantic_contract: semanticContract?.sha256 || null,
  lenses,
  risk_signals: riskSignals,
  intended_acceptance_claims: intendedAcceptanceClaims,
  unavailable_proof: unavailableProof,
  requested_completion_state: requestedCompletionState,
  evidence_state: sha256(JSON.stringify(evidence)),
  interfaces: interfaces.map(({ path: relative, sha256: hash }) => [relative, hash])
})).slice(0, 24);
const directory = path.join(runtime, 'reviews', identity);
const packagePath = path.join(directory, 'review-package.json');
const diffPath = path.join(directory, 'authoritative.diff');
const dirtyPatchPath = path.join(directory, 'dirty-tracked.diff');
const canonicalPaths = authoritative.map(({ path: relative }) => relative);
const diff = canonicalPaths.length
  ? runGit([
    'diff', '--binary', '--no-ext-diff', '--no-color', `${base}..${head}`, '--',
    ...canonicalPaths
  ], root).stdout
  : '';
const reviewPackage = {
  schema_version: 2,
  id: identity,
  attempt_type: attemptType,
  attempt_id: attemptId,
  seam_id: seamId,
  base,
  head,
  candidate_checkout: candidateCheckout,
  dirty_state: {
    dirty_tree_fingerprint: candidateCheckout.dirty_tree_fingerprint,
    reconstructable: true,
    tracked_patch: dirtyPatchPath,
    untracked_files: dirtyUntrackedFiles
  },
  requirements,
  binding_requirements: bindingRequirements,
  requirement_matrix: requirementMatrix,
  semantic_contract: semanticContract,
  lenses,
  risk_signals: riskSignals,
  intended_acceptance_claims: intendedAcceptanceClaims,
  unavailable_proof: unavailableProof,
  requested_completion_state: requestedCompletionState,
  review_objective: 'Attempt to falsify every intended acceptance claim and report unverified obligations.',
  authoritative_changed_files: authoritative,
  authoritative_diff: diffPath,
  relevant_unchanged_interfaces: interfaces,
  generated_mirrors: generated,
  evidence
};
const packageContents = `${JSON.stringify(reviewPackage, null, 2)}\n`;
const reviewsDirectory = path.dirname(directory);
const temporaryDirectory = path.join(
  reviewsDirectory,
  `.temporary-${identity}-${process.pid}-${Date.now()}`
);
await mkdir(reviewsDirectory, { recursive: true });
await mkdir(temporaryDirectory, { recursive: false });
let status = 'created';
try {
  await writeFile(path.join(temporaryDirectory, 'authoritative.diff'), diff, { flag: 'wx' });
  await writeFile(path.join(temporaryDirectory, 'dirty-tracked.diff'), dirtyTrackedPatch, { flag: 'wx' });
  await writeFile(path.join(temporaryDirectory, 'review-package.json'), packageContents, { flag: 'wx' });
  try {
    await rename(temporaryDirectory, directory);
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    const [existingPackage, existingDiff, existingDirtyPatch] = await Promise.all([
      readFile(packagePath, 'utf8'),
      readFile(diffPath, 'utf8'),
      readFile(dirtyPatchPath)
    ]);
    if (existingPackage !== packageContents
      || existingDiff !== diff
      || Buffer.compare(existingDirtyPatch, dirtyTrackedPatch) !== 0) {
      throw new Error(`immutable review package collision or mutation detected: ${identity}`);
    }
    status = 'existing';
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
writeLine(JSON.stringify({
  schema_version: 2,
  status,
  id: identity,
  attempt_type: attemptType,
  attempt_id: attemptId,
  seam_id: seamId,
  base,
  head,
  authoritative_files: authoritative.length,
  generated_mirrors: generated.length,
  evidence_receipts: evidence.length,
  package: packagePath
}));
