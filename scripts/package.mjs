import { readFile, rm, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, createZip } from './lib/zip.mjs';
import { createTarGzip } from './lib/tar.mjs';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';
import { versionRecords } from './lib/version-files.mjs';
import { buildMetadata } from './lib/build-metadata.mjs';
import { directInvocation } from './lib/path-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const operationalScripts = [
  'scripts/archive-safety.mjs', 'scripts/change-snapshot.mjs',
  'scripts/capability-cache.mjs',
  'scripts/codex-cachebuster.mjs',
  'scripts/context-index.mjs',
  'scripts/benchmark-codex.mjs',
  'scripts/delegation-record.mjs', 'scripts/model-routing.mjs',
  'scripts/adapter-config.mjs', 'scripts/convergence.mjs',
  'scripts/dispatch-record.mjs', 'scripts/doctor.mjs',
  'scripts/docs-hygiene.mjs',
  'scripts/evidence.mjs', 'scripts/host-smoke.mjs',
  'scripts/evaluate-execution-economy.mjs',
  'scripts/init-run.mjs', 'scripts/installed-package-smoke.mjs',
  'scripts/phase-checkpoint.mjs',
  'scripts/run-control.mjs',
  'scripts/plan-conformance.mjs',
  'scripts/project-commands.mjs', 'scripts/run-budget.mjs',
  'scripts/release-evidence.mjs',
  'scripts/review-integrity.mjs', 'scripts/review-package.mjs',
  'scripts/review-lifecycle.mjs', 'scripts/assurance-accounting.mjs',
  'scripts/semantic-assurance.mjs',
  'scripts/run-postmortem.mjs',
  'scripts/secret-scan.mjs',
  'scripts/sync-skills.mjs', 'scripts/verify.mjs',
  'scripts/lib/build-metadata.mjs',
  'scripts/lib/capabilities.mjs',
  'scripts/lib/cli.mjs', 'scripts/lib/execution-budget.mjs',
  'scripts/lib/git-state.mjs', 'scripts/lib/runtime.mjs',
  'scripts/lib/config-layers.mjs', 'scripts/lib/model-routing.mjs',
  'scripts/lib/convergence.mjs', 'scripts/lib/proposal-state.mjs',
  'scripts/lib/path-identity.mjs',
  'scripts/lib/run-state.mjs',
  'scripts/lib/run-control.mjs', 'scripts/lib/run-summary.mjs',
  'scripts/lib/semantic-assurance.mjs',
  'scripts/lib/review-lifecycle.mjs',
  'scripts/lib/evidence-validity.mjs',
  'scripts/lib/release-evidence.mjs',
  'scripts/lib/tar.mjs',
  'scripts/lib/tar-reader.mjs',
  'scripts/lib/zip-reader.mjs', 'scripts/lib/zip.mjs'
];
const skillRuntimeFiles = [
  'scripts/init-run.mjs',
  'scripts/run-control.mjs',
  'scripts/delegation-record.mjs',
  'scripts/model-routing.mjs',
  'scripts/dispatch-record.mjs',
  'scripts/convergence.mjs',
  'scripts/plan-conformance.mjs',
  'scripts/project-commands.mjs',
  'scripts/evidence.mjs',
  'scripts/change-snapshot.mjs',
  'scripts/semantic-assurance.mjs',
  'scripts/review-integrity.mjs',
  ...operationalScripts.filter((entry) => entry.startsWith('scripts/lib/')),
  'config/convergence.json',
  'config/harness-capabilities.json',
  'config/model-routing.json',
  'templates/run.md'
];
const publicContracts = [
  'schemas/delegation-decision.schema.json', 'schemas/model-proposal.schema.json',
  'schemas/routing-observation.schema.json', 'schemas/convergence-decision.schema.json',
  'schemas/host-smoke-receipt.schema.json',
  'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/KNOWN_LIMITATIONS.md',
  'docs/MIGRATING-0.5.0.md', 'docs/MIGRATING-0.7.0.md'
];
const common = [
  'skills', 'agents', 'templates', 'assets', 'benchmarks', 'docs', 'config', 'schemas',
  ...operationalScripts, ...publicContracts,
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md',
  'SUPPORT.md', 'CHANGELOG.md'
]
const exclusions = ['dist', '.git', 'node_modules', '.zimster', '.opencode/.gitignore'];

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
    if (/^zimster-.*(?:\.zip|\.tgz)$/.test(entry)) await rm(path.join(outputDirectory, entry), { force: true });
  }

  const definitions = [
    ['claude', ['.claude-plugin', 'hooks', ...common]],
    ['codex', ['.agents', 'plugins/zimster', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']],
    ['openai', ['.codex-plugin', 'skills', 'assets', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md', 'SUPPORT.md']],
    ['portable', ['plugin.json', 'skills', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md', 'SUPPORT.md', 'docs/SKILLS_ONLY.md']]
  ];

  const outputs = [];
  for (const [target, includes] of definitions) {
    const entries = await collectFiles(root, includes, exclusions);
    if (target === 'openai' || target === 'portable') {
      const runtimeEntries = await collectFiles(root, skillRuntimeFiles, exclusions);
      for (const [relative, source] of runtimeEntries) {
        entries.push([`skills/using-zimster/${relative}`, source]);
      }
      entries.sort(([a], [b]) => a.localeCompare(b));
    }
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
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const npmIncludes = [];
  for (const include of packageJson.files) {
    if (include === 'docs/*.md') {
      for (const entry of await readdir(path.join(root, 'docs'))) {
        if (entry.endsWith('.md')) npmIncludes.push(`docs/${entry}`);
      }
    } else npmIncludes.push(include);
  }
  npmIncludes.push('package.json');
  const npmEntries = await collectFiles(root, npmIncludes, exclusions);
  const npmMetadata = Buffer.from(`${JSON.stringify(await buildMetadata(root, 'npm'), null, 2)}\n`);
  for (const entry of npmEntries) {
    if (entry[0].endsWith('skills/using-zimster/references/build-metadata.json')) {
      entry[1] = { data: npmMetadata, mode: 0o644 };
    }
  }
  const npmOutput = path.join(outputDirectory, `zimster-${version}.tgz`);
  await createTarGzip(npmOutput, npmEntries);
  outputs.push(npmOutput);
  return outputs;
}

const invokedDirectly = await directInvocation(import.meta.url, process.argv[1]);
if (invokedDirectly) {
  const outputs = await createPackages();
  for (const output of outputs) console.log(path.relative(root, output));
}
