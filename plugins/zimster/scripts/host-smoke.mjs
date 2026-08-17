import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { executableAvailable } from './lib/path-identity.mjs';
import { archivePathProblem, readStoredZip } from './lib/zip-reader.mjs';
import { readTarGzip } from './lib/tar-reader.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';

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
const publicHostIds = config.public_host_ids || config.required_host_ids || config.hosts.map(({ id }) => id);
if (!Array.isArray(publicHostIds) || !publicHostIds.length || publicHostIds.some((id) => typeof id !== 'string' || !id)) {
  throw new Error('host smoke config public_host_ids must be a non-empty string array');
}
const releaseChannel = String(options.channel || config.default_release_channel || 'public_beta');
const releaseProfiles = config.release_profiles || {
  public_beta: { minimum_live_verified_hosts: 1, required_live_host_ids: [] },
  stable: { minimum_live_verified_hosts: publicHostIds.length, required_live_host_ids: publicHostIds }
};
const releasePolicy = releaseProfiles[releaseChannel];
if (
  !releasePolicy
  || !Number.isInteger(releasePolicy.minimum_live_verified_hosts)
  || releasePolicy.minimum_live_verified_hosts < 1
  || !Array.isArray(releasePolicy.required_live_host_ids)
) {
  throw new Error(`host smoke release profile is invalid or unavailable: ${releaseChannel}`);
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
const verificationStates = new Set([
  'LIVE_VERIFIED', 'INSTALLED_PACKAGE_VERIFIED', 'STRUCTURALLY_VALIDATED',
  'BLOCKED_BY_AUTHENTICATION', 'UNAVAILABLE', 'UNSUPPORTED'
]);

function freshness(verifiedAt = new Date()) {
  const maxAgeDays = Number.isInteger(config.max_age_days) ? config.max_age_days : 90;
  return {
    verified_at: verifiedAt.toISOString(),
    expires_at: new Date(verifiedAt.getTime() + maxAgeDays * 86_400_000).toISOString()
  };
}

function hostRecord(host, {
  verificationState,
  candidate = null,
  hostVersion = null,
  commandsOrObservations = [],
  capabilitiesEstablished = [],
  publicClaims = capabilitiesEstablished,
  modelBackedExecution = false,
  authenticationStatus = 'unavailable',
  configurationStatus = 'unavailable',
  knownLimitations = []
}) {
  const timestamp = freshness();
  return {
    id: host.id,
    host_version: hostVersion,
    candidate: host.candidate,
    ...(candidate ? {
      archive: candidate.archive,
      archive_sha256: candidate.archiveSha256
    } : {}),
    candidate_commit: candidate?.metadata.source_commit || candidateHead,
    candidate_tree: candidate?.metadata.source_tree || candidateTree,
    verification_state: verificationState,
    commands_or_observations: commandsOrObservations,
    receipt_ids: [],
    authentication: {
      available: authenticationStatus === 'available',
      status: authenticationStatus
    },
    configuration: {
      available: configurationStatus === 'isolated' || configurationStatus === 'available',
      status: configurationStatus
    },
    model_backed_execution: modelBackedExecution,
    capabilities_established: capabilitiesEstablished,
    capabilities_not_established: [...new Set([
      ...(host.capabilities_not_established || []),
      ...(!modelBackedExecution && !capabilitiesEstablished.includes('model_backed_execution')
        ? ['model_backed_execution']
        : [])
    ])],
    public_claims: publicClaims,
    installation_available: host.installation_available !== false,
    known_limitations: knownLimitations,
    ...timestamp
  };
}

async function candidateDirectory(host) {
  const matchingArchives = (await readdir(dist)).filter((name) => (
    host.candidate === 'npm'
      ? /^zimster-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/.test(name)
      : name.endsWith(`-${host.candidate}.zip`)
  ));
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
  const archiveEntries = host.candidate === 'npm'
    ? await readTarGzip(archive)
    : await readStoredZip(archive);
  for (const entry of archiveEntries) {
    const problem = archivePathProblem(entry.name);
    if (problem) throw new Error(`${entry.name}: ${problem}`);
    const target = path.join(destination, ...entry.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  const installedRoot = host.candidate === 'codex'
    ? path.join(destination, 'plugins', 'zimster')
    : host.candidate === 'npm'
      ? path.join(destination, 'package')
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
  return { directory: installedRoot, archive: archiveName, archiveSha256, metadata };
}

try {
  for (const host of config.hosts) {
    if (!host || typeof host.id !== 'string' || !host.id) {
      throw new Error('host smoke entries require id');
    }
    if (!['claude', 'codex', 'npm', 'portable'].includes(host.candidate)) {
      throw new Error(`host ${host.id} requires an exact claude, codex, npm, or portable candidate`);
    }
    if (!['exact_package_capability', 'exact_package_install_and_fresh_session_discovery'].includes(host.proof_kind)) {
      throw new Error(`host ${host.id} requires an exact-package capability proof`);
    }
    const fallbackState = String(host.fallback_verification_state || 'UNAVAILABLE');
    if (!verificationStates.has(fallbackState) || fallbackState === 'LIVE_VERIFIED') {
      throw new Error(`host ${host.id} has an invalid non-live fallback verification state`);
    }
    const fallbackResult = async (reason) => {
      let candidate = null;
      let verificationState = fallbackState;
      if (!['UNAVAILABLE', 'UNSUPPORTED', 'BLOCKED_BY_AUTHENTICATION'].includes(fallbackState)) {
        try {
          candidate = await candidateDirectory(host);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          verificationState = 'UNAVAILABLE';
        }
      }
      const capabilities = verificationState === 'INSTALLED_PACKAGE_VERIFIED'
        ? (host.capabilities_established || ['package_installation'])
        : verificationState === 'STRUCTURALLY_VALIDATED'
          ? (host.capabilities_established || ['adapter_structure'])
          : [];
      return hostRecord(host, {
        verificationState,
        candidate,
        commandsOrObservations: host.structural_observations || [reason],
        capabilitiesEstablished: capabilities,
        publicClaims: verificationState === fallbackState ? (host.public_claims || capabilities) : [],
        authenticationStatus: verificationState === 'BLOCKED_BY_AUTHENTICATION'
          ? 'blocked'
          : 'unavailable',
        knownLimitations: host.known_limitations || [reason]
      });
    };
    if (!host.command) {
      const reason = String(host.unavailable_reason || 'host smoke is not configured');
      const result = await fallbackResult(reason);
      unavailable.push({ id: result.id, reason });
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
      const reason = String(host.unavailable_reason || `${host.command} is not installed`);
      const unavailableResult = await fallbackResult(reason);
      unavailable.push({ id: unavailableResult.id, reason });
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
        CODEX_HOME: path.join(home, 'codex'),
        CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
        GROK_HOME: path.join(home, 'grok'),
        PI_CODING_AGENT_DIR: path.join(home, 'pi')
      }
    });
    if (result.error?.code === 'ENOENT') {
      const reason = String(host.unavailable_reason || `${host.command} is not installed`);
      const unavailableResult = await fallbackResult(reason);
      unavailable.push({ id: unavailableResult.id, reason });
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
      hostResults.push(hostRecord(host, {
        verificationState: 'UNAVAILABLE',
        candidate,
        commandsOrObservations: [[host.command, ...(host.args || [])].join(' ')],
        knownLimitations: ['configured live smoke failed']
      }));
      continue;
    }
    if (host.expected_output && !combinedOutput.includes(String(host.expected_output))) {
      failures.push({
        id: host.id,
        exit_code: 1,
        action: `expected output was not found: ${host.expected_output}`
      });
      hostResults.push(hostRecord(host, {
        verificationState: 'UNAVAILABLE',
        candidate,
        commandsOrObservations: [[host.command, ...(host.args || [])].join(' ')],
        knownLimitations: ['configured live smoke output did not establish discovery']
      }));
      continue;
    }
    executed.push(host.id);
    const modelBackedExecution = host.model_backed_execution === true;
    const successVerificationState = String(host.success_verification_state || 'LIVE_VERIFIED');
    if (!verificationStates.has(successVerificationState)) {
      throw new Error(`host ${host.id} has an invalid success verification state`);
    }
    const liveCapabilities = [
      ...(host.live_capabilities_established || [
        'package_installation', 'fresh_session_discovery', 'live_host_execution'
      ]),
      ...(modelBackedExecution ? ['model_backed_execution'] : [])
    ];
    let hostVersion = host.host_version || null;
    let versionFailure = null;
    if (Array.isArray(host.version_args)) {
      const versionResult = spawnSync(String(host.command), host.version_args, {
        encoding: 'utf8', shell: false, env: process.env
      });
      if (versionResult.status === 0) hostVersion = String(versionResult.stdout || '').trim() || hostVersion;
      else if (host.expected_version_pattern) {
        versionFailure = 'the configured host version command did not succeed';
      }
    }
    if (host.expected_version_pattern) {
      let expectedVersion;
      try {
        expectedVersion = new RegExp(String(host.expected_version_pattern));
      } catch {
        throw new Error(`host ${host.id} expected_version_pattern must be a valid regular expression`);
      }
      if (!versionFailure && !expectedVersion.test(hostVersion || '')) {
        versionFailure = `observed host version ${hostVersion || '(unavailable)'} differs from the documented release target`;
      }
    }
    if (versionFailure) {
      failures.push({ id: host.id, exit_code: 1, action: versionFailure });
      hostResults.push(hostRecord(host, {
        verificationState: 'UNAVAILABLE',
        candidate,
        hostVersion,
        commandsOrObservations: [[host.command, ...(host.args || [])].join(' ')],
        knownLimitations: [versionFailure]
      }));
      continue;
    }
    const liveRecord = hostRecord(host, {
      verificationState: successVerificationState,
      candidate,
      hostVersion,
      commandsOrObservations: [[host.command, ...(host.args || [])].join(' ')],
      capabilitiesEstablished: liveCapabilities,
      publicClaims: host.live_public_claims || liveCapabilities,
      modelBackedExecution,
      authenticationStatus: host.authentication_available === false || successVerificationState !== 'LIVE_VERIFIED'
        ? 'unavailable'
        : 'available',
      configurationStatus: 'isolated',
      knownLimitations: host.known_limitations || []
    });
    liveRecord.exact_package_install = liveCapabilities.includes('package_installation');
    liveRecord.fresh_session_discovery = liveCapabilities.includes('fresh_session_discovery');
    hostResults.push(liveRecord);
  }
  const liveVerifiedHostIds = hostResults
    .filter(({ verification_state: state }) => state === 'LIVE_VERIFIED')
    .map(({ id }) => id);
  let policySatisfied = liveVerifiedHostIds.length >= releasePolicy.minimum_live_verified_hosts
    && releasePolicy.required_live_host_ids.every((id) => liveVerifiedHostIds.includes(id));
  const allClaimsBounded = hostResults.every((host) => {
    const established = new Set(host.capabilities_established || []);
    return (host.public_claims || []).every((claim) => established.has(claim))
      && (!host.public_claims?.includes('live_host_execution') || host.verification_state === 'LIVE_VERIFIED')
      && (!host.public_claims?.includes('model_backed_execution') || host.model_backed_execution === true);
  });
  if (!allClaimsBounded) {
    failures.push({ id: 'claim-scope', exit_code: 1, action: 'a public harness claim exceeds its receipt evidence' });
    policySatisfied = false;
  }
  if (policySatisfied && (
    !/^[0-9a-f]{40}$/.test(candidateHead || '')
    || !/^[0-9a-f]{40}$/.test(candidateTree || '')
    || dirtyTreeFingerprint !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )) {
    failures.push({
      id: 'candidate-binding',
      exit_code: 1,
      action: 'exact-package host smoke requires a clean immutable candidate head and tree'
    });
    policySatisfied = false;
  }
  const summary = {
    schema_version: 3,
    status: failures.length ? 'failed' : policySatisfied ? 'passed' : 'BLOCKED_BY_ENVIRONMENT',
    release_channel: releaseChannel,
    policy: releasePolicy,
    public_host_ids: publicHostIds,
    all_claims_bounded: allClaimsBounded,
    live_verified_host_ids: liveVerifiedHostIds,
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
    let canonical = null;
    let repo = null;
    let runtime = null;
    try {
      repo = findRepoRoot(process.cwd());
      runtime = await ensureRuntimeDirectory(repo);
      canonical = path.join(runtime, 'host-smoke', 'latest.json');
    } catch {}
    if (canonical && path.resolve(receipt) === path.resolve(canonical)) {
      await withControlPlaneMutation(runtime, repo, {
        mutationType: 'host_smoke_recorded'
      }, () => writeFile(receipt, `${JSON.stringify(summary, null, 2)}\n`));
    } else {
      await writeFile(receipt, `${JSON.stringify(summary, null, 2)}\n`);
    }
    summary.receipt = receipt;
  }
  writeLine(JSON.stringify(summary));
  if (failures.length) process.exitCode = 1;
  else if (!policySatisfied) process.exitCode = 2;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
