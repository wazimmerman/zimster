import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directInvocation } from './lib/path-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'plugins', 'zimster');
const includes = [
  '.codex-plugin', 'skills', 'agents', 'templates', 'assets', 'benchmarks', 'config', 'schemas',
  'docs/ARCHITECTURE.md', 'docs/CLAUDE.md', 'docs/CODEX.md', 'docs/CURSOR.md',
  'docs/DIAGNOSTICS.md', 'docs/EVALUATION.md', 'docs/GROK.md', 'docs/KIMI.md',
  'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/KNOWN_LIMITATIONS.md',
  'docs/MIGRATING-0.5.0.md',
  'docs/OPENCODE.md', 'docs/OPERATIONS.md', 'docs/PI.md', 'docs/PORTING.md',
  'docs/RELEASING.md', 'docs/COMPATIBILITY.md', 'docs/ROADMAP.md',
  'docs/SKILLS_ONLY.md', 'docs/UPSTREAM.md',
  'scripts/archive-safety.mjs', 'scripts/change-snapshot.mjs',
  'scripts/capability-cache.mjs',
  'scripts/context-index.mjs',
  'scripts/benchmark-codex.mjs',
  'scripts/dispatch-record.mjs',
  'scripts/delegation-record.mjs', 'scripts/model-routing.mjs',
  'scripts/adapter-config.mjs', 'scripts/convergence.mjs',
  'scripts/codex-cachebuster.mjs', 'scripts/doctor.mjs', 'scripts/evidence.mjs',
  'scripts/evaluate-execution-economy.mjs',
  'scripts/host-smoke.mjs', 'scripts/init-run.mjs',
  'scripts/installed-package-smoke.mjs', 'scripts/phase-checkpoint.mjs',
  'scripts/plan-conformance.mjs',
  'scripts/project-commands.mjs', 'scripts/run-budget.mjs',
  'scripts/release-evidence.mjs',
  'scripts/review-integrity.mjs', 'scripts/review-package.mjs',
  'scripts/semantic-assurance.mjs',
  'scripts/run-postmortem.mjs',
  'scripts/secret-scan.mjs',
  'scripts/sync-skills.mjs', 'scripts/verify.mjs',
  'scripts/lib/build-metadata.mjs', 'scripts/lib/capabilities.mjs',
  'scripts/lib/cli.mjs', 'scripts/lib/execution-budget.mjs',
  'scripts/lib/git-state.mjs', 'scripts/lib/runtime.mjs',
  'scripts/lib/config-layers.mjs', 'scripts/lib/model-routing.mjs',
  'scripts/lib/convergence.mjs', 'scripts/lib/proposal-state.mjs',
  'scripts/lib/path-identity.mjs',
  'scripts/lib/run-state.mjs',
  'scripts/lib/semantic-assurance.mjs',
  'scripts/lib/evidence-validity.mjs',
  'scripts/lib/release-evidence.mjs',
  'scripts/lib/tar-reader.mjs',
  'scripts/lib/zip-reader.mjs', 'scripts/lib/zip.mjs',
  'vendor/openai-codex-plugin-validator',
  'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md',
  'SUPPORT.md', 'CHANGELOG.md'
];

async function copyCanonical(destination) {
  await mkdir(destination, { recursive: true });
  for (const relative of includes) {
    await cp(path.join(root, relative), path.join(destination, relative), { recursive: true });
  }
}

async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(absolute, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

async function digestTree(directory) {
  const files = await filesUnder(directory);
  const map = new Map();
  for (const relative of files) {
    const data = await readFile(path.join(directory, ...relative.split('/')));
    map.set(relative, createHash('sha256').update(data).digest('hex'));
  }
  return map;
}

function compareMaps(expected, actual) {
  const differences = [];
  for (const [file, hash] of expected) {
    if (!actual.has(file)) differences.push(`missing ${file}`);
    else if (actual.get(file) !== hash) differences.push(`changed ${file}`);
  }
  for (const file of actual.keys()) if (!expected.has(file)) differences.push(`extra ${file}`);
  return differences;
}

export async function syncCodexPlugin({ check = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-codex-sync-'));
  try {
    await copyCanonical(temporary);
    if (check) {
      try {
        if (!(await stat(target)).isDirectory()) throw new Error('not directory');
      } catch {
        return ['missing plugins/zimster'];
      }
      return compareMaps(await digestTree(temporary), await digestTree(target));
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(temporary, target, { recursive: true });
    return [];
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const direct = await directInvocation(import.meta.url, process.argv[1]);
if (direct) {
  const check = process.argv.includes('--check');
  const differences = await syncCodexPlugin({ check });
  if (differences.length) {
    console.error(`Codex plugin mirror is stale (${differences.length} difference(s)):`);
    for (const difference of differences) console.error(`- ${difference}`);
    process.exitCode = 1;
  } else {
    console.log(check ? 'Codex plugin mirror is current.' : 'Updated plugins/zimster from canonical source.');
  }
}
