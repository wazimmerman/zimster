import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue, runGit } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { options } = parseOptions(process.argv.slice(2));
const root = findRepoRoot(process.cwd());
const head = String(options.head || gitValue(['rev-parse', 'HEAD'], root, '')).toLowerCase();
const defaultBase = gitValue(['merge-base', 'origin/main', head], root, null)
  || gitValue(['rev-parse', `${head}^`], root, head);
const base = String(options.base || defaultBase || '').toLowerCase();

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
  return options[name]
    ? String(options[name]).split(',').map((value) => value.trim()).filter(Boolean)
    : [];
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
const lenses = listOption('lenses');
const runtime = await ensureRuntimeDirectory(root);
let evidence = [];
try {
  const rows = (await readFile(path.join(runtime, 'evidence', 'receipts.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const invalidated = new Map(
    rows.filter((row) => row.record_type === 'invalidation')
      .map((row) => [row.receipt_id, row.reason])
  );
  evidence = rows.filter((row) => row.record_type !== 'invalidation').slice(-20).map((row) => ({
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    exit_code: row.exit_code,
    git_commit: row.git_commit || row.git_head,
    status: invalidated.has(row.id) ? 'stale' : row.exit_code === 0 ? 'recorded_pass' : 'recorded_fail',
    ...(invalidated.has(row.id) ? { invalidation_reason: invalidated.get(row.id) } : {})
  }));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const identity = sha256(JSON.stringify({
  base,
  head,
  requirements: requirements?.sha256 || null,
  lenses,
  interfaces: interfaces.map(({ path: relative, sha256: hash }) => [relative, hash])
})).slice(0, 24);
const directory = path.join(runtime, 'reviews', identity);
const packagePath = path.join(directory, 'review-package.json');
const diffPath = path.join(directory, 'authoritative.diff');
await mkdir(directory, { recursive: true });
const canonicalPaths = authoritative.map(({ path: relative }) => relative);
const diff = canonicalPaths.length
  ? runGit([
    'diff', '--binary', '--no-ext-diff', '--no-color', `${base}..${head}`, '--',
    ...canonicalPaths
  ], root).stdout
  : '';
await writeFile(diffPath, diff);
const reviewPackage = {
  schema_version: 1,
  id: identity,
  base,
  head,
  requirements,
  lenses,
  authoritative_changed_files: authoritative,
  authoritative_diff: diffPath,
  relevant_unchanged_interfaces: interfaces,
  generated_mirrors: generated,
  evidence
};
await writeFile(packagePath, `${JSON.stringify(reviewPackage, null, 2)}\n`);
writeLine(JSON.stringify({
  schema_version: 1,
  status: 'created',
  id: identity,
  base,
  head,
  authoritative_files: authoritative.length,
  generated_mirrors: generated.length,
  evidence_receipts: evidence.length,
  package: packagePath
}));
