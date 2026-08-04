import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { capabilityMatrix } from './lib/capabilities.mjs';
import { parseOptions, writeLine } from './lib/cli.mjs';
import {
  loadConfigLayers,
  resolveProjectConfigPath,
  resolveUserConfigPath
} from './lib/config-layers.mjs';
import { findRepoRoot, gitValue } from './lib/git-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { options } = parseOptions(process.argv.slice(2));

async function present(relative) {
  try { await access(path.join(root, relative)); return 'ready'; } catch { return 'missing'; }
}

async function jsonFile(relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

const sourceCheckout = await present('package.json') === 'ready'
  && await present('plugins/zimster/.codex-plugin/plugin.json') === 'ready';
const codexPackage = await present('.codex-plugin/plugin.json') === 'ready';
const versionSource = sourceCheckout ? 'package.json' : codexPackage
  ? '.codex-plugin/plugin.json'
  : 'skills/using-zimster/references/build-metadata.json';
const versionPayload = await jsonFile(versionSource);
const version = versionPayload.version || versionPayload.semantic_version;
const packageTarget = sourceCheckout ? 'source' : codexPackage ? 'codex' : versionPayload.package_target;
let versionMetadata = { status: 'package-local' };
let codexMirror = { status: sourceCheckout ? 'unchecked' : 'not_applicable' };

if (sourceCheckout) {
  const [{ versionRecords }, { syncCodexPlugin }] = await Promise.all([
    import('./lib/version-files.mjs'),
    import('./sync-codex-plugin.mjs')
  ]);
  const mismatches = (await versionRecords()).filter(([, value]) => value !== version);
  const mirrorDifferences = await syncCodexPlugin({ check: true });
  versionMetadata = mismatches.length
    ? { status: 'mismatch', differences: mismatches }
    : { status: 'synchronized' };
  codexMirror = mirrorDifferences.length
    ? { status: 'stale', differences: mirrorDifferences }
    : { status: 'current' };
}

const matrix = await capabilityMatrix(root);
async function allPresent(...relatives) {
  const states = await Promise.all(relatives.map(present));
  return states.every((state) => state === 'ready') ? 'ready' : 'missing';
}

const structural = sourceCheckout ? {
  codex: await present('plugins/zimster/.codex-plugin/plugin.json'),
  claude: await present('.claude-plugin/plugin.json'),
  cursor: await present('.cursor/commands/using-zimster.md'),
  kimi: await present('.kimi-plugin/plugin.json'),
  opencode: await allPresent('.opencode/plugins/zimster.js', 'skills/using-zimster/SKILL.md'),
  pi: await allPresent('.pi/extensions/zimster.ts', 'skills/using-zimster/SKILL.md')
} : {
  codex: codexPackage ? 'ready' : 'not_packaged',
  claude: await present('.claude-plugin/plugin.json'),
  cursor: 'not_packaged',
  kimi: await present('.kimi-plugin/plugin.json'),
  opencode: 'not_packaged',
  pi: 'not_packaged'
};
const harnesses = Object.fromEntries(Object.entries(matrix.harnesses).map(([name, record]) => [
  name,
  { ...record, structural_status: structural[name] }
]));
let routingLayers = { layers: [], effective: {}, digest: 'unavailable' };
if (sourceCheckout) {
  let projectPath = null;
  try { projectPath = resolveProjectConfigPath(findRepoRoot(root)); } catch {}
  routingLayers = await loadConfigLayers({
    projectPath,
    userPath: resolveUserConfigPath()
  });
}
const routingConfig = routingLayers.effective.routing || {};
let betaReceipt = null;
if (sourceCheckout) {
  try {
    const receiptPath = gitValue([
      'rev-parse', '--path-format=absolute', '--git-path', 'zimster/host-smoke/latest.json'
    ], findRepoRoot(root), null);
    if (receiptPath) betaReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch {}
}
const receiptHosts = new Map((betaReceipt?.hosts || []).map((host) => [host.id, host]));
const supportMatrix = Object.fromEntries(Object.keys(matrix.harnesses).map((name) => {
  const receipt = receiptHosts.get(name);
  const capability = matrix.harnesses[name];
  return [name, receipt ? {
    verification_level: receipt.verification_state,
    tested: receipt.commands_or_observations,
    not_tested: receipt.capabilities_not_established,
    installation_available: receipt.installation_available,
    known_limitations: receipt.known_limitations,
    public_claims: receipt.public_claims,
    model_backed_execution: receipt.model_backed_execution,
    expires_at: receipt.expires_at
  } : {
    verification_level: capability.verification === 'structurally_validated'
      ? 'STRUCTURALLY_VALIDATED'
      : 'UNAVAILABLE',
    tested: capability.verification === 'structurally_validated'
      ? ['checked-in adapter structure']
      : [],
    not_tested: ['exact-package live host execution', 'model-backed execution'],
    installation_available: structural[name] === 'ready',
    known_limitations: ['no current exact-package host receipt'],
    public_claims: capability.verification === 'structurally_validated'
      ? ['adapter_structure']
      : [],
    model_backed_execution: false,
    expires_at: null
  }];
}));
const report = {
  schema_version: 1,
  zimster_version: version,
  package_target: packageTarget,
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version },
  version_metadata: versionMetadata,
  codex_mirror: codexMirror,
  routing: {
    mode: routingConfig.mode || 'inherit',
    policy: routingConfig.policy || 'balanced',
    strict_cost: routingConfig.strict_cost === true,
    configuration_digest: routingLayers.digest,
    layers: routingLayers.layers.map(({ source, digest, routing_keys: routingKeys, has_mappings: hasMappings }) => ({
      source, digest, routing_keys: routingKeys, has_mappings: hasMappings
    })),
    mapping_count: Object.values(routingConfig.mappings || {}).reduce(
      (total, candidates) => total + (Array.isArray(candidates) ? candidates.length : 0), 0
    )
  },
  public_beta: betaReceipt
    ? {
      status: betaReceipt.status,
      release_channel: betaReceipt.release_channel,
      minimum_live_verified_hosts: betaReceipt.policy?.minimum_live_verified_hosts,
      live_verified_host_ids: betaReceipt.live_verified_host_ids,
      all_claims_bounded: betaReceipt.all_claims_bounded,
      executed: betaReceipt.executed,
      unavailable: betaReceipt.unavailable.map(({ id }) => id),
      generated_at: betaReceipt.generated_at
    }
    : {
      status: 'BLOCKED_BY_ENVIRONMENT',
      release_channel: 'public_beta',
      minimum_live_verified_hosts: 1,
      live_verified_host_ids: [],
      all_claims_bounded: false,
      executed: [],
      unavailable: Object.keys(matrix.harnesses),
      reason: 'no current exact-package LIVE_VERIFIED host receipt'
    },
  harnesses,
  support_matrix: supportMatrix
};

if (options.json === true) {
  writeLine(JSON.stringify(report));
} else {
  const lines = [
    `Zimster ${version} (${packageTarget})`,
    `Host: ${report.host.platform} ${report.host.release} (${report.host.arch})`,
    `Node: ${report.host.node}`,
    ''
  ];
  for (const [name, record] of Object.entries(harnesses)) {
    const support = supportMatrix[name];
    lines.push(`${name.padEnd(10)} ${support.verification_level.padEnd(30)} package=${record.structural_status} model_backed=${support.model_backed_execution}`);
  }
  lines.push(
    '',
    `Version metadata: ${report.version_metadata.status}`,
    `Codex mirror: ${report.codex_mirror.status}`,
    `Routing: ${report.routing.mode}/${report.routing.policy} mappings=${report.routing.mapping_count}`,
    'Structural and capability diagnostics are not live harness installation claims.'
  );
  writeLine(lines.join('\n'));
}
