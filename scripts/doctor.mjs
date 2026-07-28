import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { capabilityMatrix } from './lib/capabilities.mjs';
import { parseOptions, writeLine } from './lib/cli.mjs';

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
const report = {
  schema_version: 1,
  zimster_version: version,
  package_target: packageTarget,
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version },
  version_metadata: versionMetadata,
  codex_mirror: codexMirror,
  harnesses
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
    lines.push(`${name.padEnd(10)} ${record.verification.padEnd(24)} package=${record.structural_status}`);
  }
  lines.push(
    '',
    `Version metadata: ${report.version_metadata.status}`,
    `Codex mirror: ${report.codex_mirror.status}`,
    'Structural and capability diagnostics are not live harness installation claims.'
  );
  writeLine(lines.join('\n'));
}
