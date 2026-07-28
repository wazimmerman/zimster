import { readFile, rm, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, createZip } from './lib/zip.mjs';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';
import { versionRecords } from './lib/version-files.mjs';
import { buildMetadata } from './lib/build-metadata.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const operationalScripts = [
  'scripts/change-snapshot.mjs', 'scripts/codex-cachebuster.mjs',
  'scripts/dispatch-record.mjs', 'scripts/doctor.mjs',
  'scripts/evidence.mjs', 'scripts/init-run.mjs', 'scripts/project-commands.mjs',
  'scripts/sync-skills.mjs', 'scripts/lib/build-metadata.mjs',
  'scripts/lib/capabilities.mjs',
  'scripts/lib/cli.mjs', 'scripts/lib/git-state.mjs', 'scripts/lib/runtime.mjs'
];
const common = [
  'skills', 'agents', 'templates', 'assets', 'docs', 'config', 'schemas',
  ...operationalScripts,
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md',
  'SUPPORT.md', 'CHANGELOG.md'
]
const exclusions = ['dist', '.git', 'node_modules', '.zimster'];

export async function createPackages(outputDirectory = path.join(root, 'dist')) {
  const versionRows = await versionRecords();
  const canonicalVersion = versionRows.find(([name]) => name === 'package.json')?.[1];
  const mismatches = versionRows.filter(([, version]) => version !== canonicalVersion);
  if (mismatches.length) throw new Error(`version metadata is stale: ${mismatches.map(([name, version]) => `${name}=${version ?? 'missing'}`).join(', ')}`);
  const mirrorDifferences = await syncCodexPlugin({ check: true });
  if (mirrorDifferences.length) throw new Error(`Codex plugin mirror is stale: ${mirrorDifferences.join(', ')}`);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of await readdir(outputDirectory)) {
    if (/^zimster-.*\.zip$/.test(entry)) await rm(path.join(outputDirectory, entry), { force: true });
  }

  const definitions = [
    ['claude', ['.claude-plugin', 'hooks', ...common]],
    ['codex', ['.agents', 'plugins/zimster', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']],
    ['portable', ['.agents', '.claude-plugin', '.codex-plugin', '.cursor-plugin', '.kimi-plugin', '.opencode', '.pi', 'plugins/zimster', 'hooks', 'scripts', 'vendor', 'package.json', 'package-lock.json', ...common]]
  ];

  const outputs = [];
  for (const [target, includes] of definitions) {
    const entries = await collectFiles(root, includes, exclusions);
    const metadata = Buffer.from(`${JSON.stringify(await buildMetadata(root, target), null, 2)}\n`);
    for (const entry of entries) {
      if (entry[0].endsWith('skills/using-zimster/references/build-metadata.json')) {
        entry[1] = { data: metadata, mode: 0o644 };
      }
    }
    const output = path.join(outputDirectory, `zimster-${version}-${target}.zip`);
    await createZip(output, entries);
    outputs.push(output);
  }
  return outputs;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outputs = await createPackages();
  for (const output of outputs) console.log(path.relative(root, output));
}
