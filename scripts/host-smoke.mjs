import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { executableAvailable } from './lib/path-identity.mjs';
import { archivePathProblem, readStoredZip } from './lib/zip-reader.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { options } = parseOptions(process.argv.slice(2));
const configFile = path.resolve(
  process.cwd(),
  String(options.config || path.join(packageRoot, 'config', 'host-smoke.json'))
);
const config = JSON.parse(await readFile(configFile, 'utf8'));
if (config.schema_version !== 1 || !Array.isArray(config.hosts)) {
  throw new Error('host smoke config requires schema_version 1 and hosts');
}
const requiredHostIds = config.required_host_ids || config.hosts.map(({ id }) => id);
if (!Array.isArray(requiredHostIds) || !requiredHostIds.length || requiredHostIds.some((id) => typeof id !== 'string' || !id)) {
  throw new Error('host smoke config required_host_ids must be a non-empty string array');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-host-smoke-'));
const dist = path.resolve(process.cwd(), String(options.dist || 'dist'));
const executed = [];
const unavailable = [];
const failures = [];
const hostResults = [];
const artifactDigests = {};

let candidateState = null;
try {
  candidateState = await captureGitState(findRepoRoot(process.cwd()));
} catch {}
const candidateHead = options['candidate-head']
  ? String(options['candidate-head'])
  : candidateState?.head || null;
const candidateTree = options['candidate-tree']
  ? String(options['candidate-tree'])
  : candidateState?.tree || null;
const dirtyTreeFingerprint = options['dirty-tree-fingerprint']
  ? String(options['dirty-tree-fingerprint'])
  : candidateState?.dirty_tree_fingerprint || null;
const cleanFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const isolationEnvironment = new Set([
  'home', 'userprofile', 'xdg_config_home', 'xdg_cache_home', 'xdg_data_home', 'codex_home'
]);

async function candidateDirectory(host) {
  const suffix = `-${host.candidate}.zip`;
  const matchingArchives = (await readdir(dist)).filter((name) => name.endsWith(suffix));
  if (matchingArchives.length !== 1) {
    throw new Error(`expected exactly one ${host.candidate} candidate archive, found ${matchingArchives.length}`);
  }
  const [archiveName] = matchingArchives;
  const archive = path.join(dist, archiveName);
  const archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  artifactDigests[host.candidate] ||= archiveSha256;
  if (artifactDigests[host.candidate] !== archiveSha256) {
    throw new Error(`conflicting exact ${host.candidate} archive digests`);
  }
  const destination = path.join(temporary, host.id, 'candidate');
  for (const entry of await readStoredZip(archive)) {
    const problem = archivePathProblem(entry.name);
    if (problem) throw new Error(`${entry.name}: ${problem}`);
    const target = path.join(destination, ...entry.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  const installedRoot = host.candidate === 'codex'
    ? path.join(destination, 'plugins', 'zimster')
    : destination;
  const metadata = JSON.parse(await readFile(path.join(
    installedRoot,
    'skills',
    'using-zimster',
    'references',
    'build-metadata.json'
  ), 'utf8'));
  if (
    metadata.schema_version !== 1
    || metadata.package_target !== host.candidate
    || metadata.source_commit !== candidateHead
    || metadata.source_tree !== candidateTree
    || metadata.source_dirty_tree_fingerprint !== cleanFingerprint
  ) {
    throw new Error(`exact ${host.candidate} archive provenance does not match the clean candidate head and tree`);
  }
  return { directory: destination, archive: archiveName, archiveSha256, metadata };
}

try {
  for (const host of config.hosts) {
    if (!host || typeof host.id !== 'string' || !host.id) {
      throw new Error('host smoke entries require id');
    }
    if (!['claude', 'codex', 'portable'].includes(host.candidate)) {
      throw new Error(`host ${host.id} requires an exact claude, codex, or portable candidate`);
    }
    if (host.proof_kind !== 'exact_package_install_and_fresh_session_discovery') {
      throw new Error(`host ${host.id} requires exact-package install and fresh-session discovery proof`);
    }
    if (!host.command) {
      const result = {
        id: host.id,
        status: 'unavailable',
        candidate: host.candidate,
        reason: String(host.unavailable_reason || 'host smoke is not configured')
      };
      unavailable.push({ id: result.id, reason: result.reason });
      hostResults.push(result);
      continue;
    }
    if (!Array.isArray(host.args || []) || !(host.args || []).every((arg) => typeof arg === 'string')) {
      throw new Error(`host ${host.id} args must be strings`);
    }
    if (
      host.env
      && (
        typeof host.env !== 'object'
        || Array.isArray(host.env)
        || Object.keys(host.env).some((name) => isolationEnvironment.has(name.toLowerCase()))
      )
    ) {
      throw new Error(`host ${host.id} may not override isolation-critical environment variables`);
    }
    const home = path.join(temporary, host.id);
    await mkdir(home, { recursive: true });
    if (!(await executableAvailable(host.command))) {
      const unavailableResult = {
        id: host.id,
        status: 'unavailable',
        candidate: host.candidate,
        reason: String(host.unavailable_reason || `${host.command} is not installed`)
      };
      unavailable.push({ id: unavailableResult.id, reason: unavailableResult.reason });
      hostResults.push(unavailableResult);
      continue;
    }
    const candidate = await candidateDirectory(host);
    const result = spawnSync(String(host.command), host.args || [], {
      cwd: candidate.directory,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        ...(host.env || {}),
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        XDG_DATA_HOME: path.join(home, 'data'),
        CODEX_HOME: path.join(home, 'codex')
      }
    });
    if (result.error?.code === 'ENOENT') {
      const unavailableResult = {
        id: host.id,
        status: 'unavailable',
        candidate: host.candidate,
        reason: String(host.unavailable_reason || `${host.command} is not installed`)
      };
      unavailable.push({ id: unavailableResult.id, reason: unavailableResult.reason });
      hostResults.push(unavailableResult);
      continue;
    }
    const combinedOutput = `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
    if (result.status !== 0 || String(result.stderr || '').trim()) {
      failures.push({
        id: host.id,
        exit_code: result.status ?? 1,
        action: String(result.stderr || result.stdout || 'host smoke failed')
          .trim().split('\n').filter(Boolean).at(-1)
      });
      hostResults.push({ id: host.id, status: 'failed', candidate: host.candidate, archive_sha256: candidate.archiveSha256 });
      continue;
    }
    if (host.expected_output && !combinedOutput.includes(String(host.expected_output))) {
      failures.push({
        id: host.id,
        exit_code: 1,
        action: `expected output was not found: ${host.expected_output}`
      });
      hostResults.push({ id: host.id, status: 'failed', candidate: host.candidate, archive_sha256: candidate.archiveSha256 });
      continue;
    }
    executed.push(host.id);
    hostResults.push({
      id: host.id,
      status: 'passed',
      candidate: host.candidate,
      archive: candidate.archive,
      archive_sha256: candidate.archiveSha256,
      source_commit: candidate.metadata.source_commit,
      source_tree: candidate.metadata.source_tree,
      exact_package_install: true,
      fresh_session_discovery: true
    });
  }
  let allRequired = requiredHostIds.every((id) => executed.includes(id));
  if (allRequired && (
    !/^[0-9a-f]{40}$/.test(candidateHead || '')
    || !/^[0-9a-f]{40}$/.test(candidateTree || '')
    || dirtyTreeFingerprint !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )) {
    failures.push({
      id: 'candidate-binding',
      exit_code: 1,
      action: 'exact-package host smoke requires a clean immutable candidate head and tree'
    });
    allRequired = false;
  }
  const summary = {
    schema_version: 2,
    status: failures.length ? 'failed' : allRequired ? 'passed' : 'BLOCKED_BY_ENVIRONMENT',
    required_host_ids: requiredHostIds,
    all_required: allRequired,
    candidate_head: candidateHead,
    candidate_tree: candidateTree,
    dirty_tree_fingerprint: dirtyTreeFingerprint,
    artifact_digests: artifactDigests,
    hosts: hostResults,
    executed,
    unavailable,
    failures,
    generated_at: new Date().toISOString()
  };
  let receipt = options.receipt ? path.resolve(process.cwd(), String(options.receipt)) : null;
  if (!receipt && !options.config) {
    try {
      receipt = path.join(await ensureRuntimeDirectory(findRepoRoot(process.cwd())), 'host-smoke', 'latest.json');
    } catch {}
  }
  if (receipt) {
    await mkdir(path.dirname(receipt), { recursive: true });
    await writeFile(receipt, `${JSON.stringify(summary, null, 2)}\n`);
    summary.receipt = receipt;
  }
  writeLine(JSON.stringify(summary));
  if (failures.length) process.exitCode = 1;
  else if (!allRequired) process.exitCode = 2;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
