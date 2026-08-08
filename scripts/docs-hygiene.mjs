import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootArgument = process.argv.indexOf('--root');
const root = rootArgument >= 0
  ? path.resolve(process.argv[rootArgument + 1] || '')
  : repositoryRoot;

const fixedPublicFiles = [
  'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md',
  'PRIVACY.md', 'TERMS.md', 'CODE_OF_CONDUCT.md', 'AGENTS.md',
  'THIRD_PARTY_NOTICES.md', 'benchmarks/README.md',
  'package.json', 'plugin.json', '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
  '.kimi-plugin/plugin.json', '.agents/plugins/marketplace.json',
  '.github/pull_request_template.md'
];

// Add an entry only for an immutable exact quotation that must retain an em dash.
// The complete line is part of the key so unrelated text on the same line cannot
// inherit the exception.
const allowedExactLines = new Set([]);

async function isFile(relative) {
  try { return (await stat(path.join(root, relative))).isFile(); }
  catch { return false; }
}

async function filesUnder(relative, extensionPattern) {
  try {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) files.push(...await filesUnder(child, extensionPattern));
      else if (entry.isFile() && extensionPattern.test(entry.name)) files.push(child);
    }
    return files;
  } catch {
    return [];
  }
}

const candidates = [
  ...fixedPublicFiles,
  ...await filesUnder('docs', /\.md$/),
  ...await filesUnder('agents', /\.md$/),
  ...await filesUnder('skills', /\.md$/),
  ...await filesUnder('templates', /\.md$/),
  ...await filesUnder('.cursor/commands', /\.md$/),
  ...await filesUnder('.github/ISSUE_TEMPLATE', /\.(?:md|ya?ml)$/)
];
const files = [...new Set(candidates)].sort();
const errors = [];
let inspected = 0;

for (const relative of files) {
  if (!await isFile(relative)) continue;
  inspected += 1;
  const lines = (await readFile(path.join(root, relative), 'utf8')).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('—')) continue;
    if (allowedExactLines.has(`${relative}\0${line}`)) continue;
    errors.push(`${relative}:${index + 1}: em dash is not allowed in first-party public prose`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Documentation hygiene passed: ${inspected} first-party public files contain no unallowlisted em dashes.`);
}
