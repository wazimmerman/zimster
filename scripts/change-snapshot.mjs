import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions } from './lib/cli.mjs';
import { findRepoRoot, gitValue, runGit, untrackedFiles } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { options } = parseOptions(process.argv.slice(2));
const root = findRepoRoot(process.cwd());
const output = options.output
  ? path.resolve(root, String(options.output))
  : path.join(await ensureRuntimeDirectory(root), 'change-snapshot.md');
const base = options.base ? String(options.base) : null;
const head = gitValue(['rev-parse', 'HEAD'], root, 'UNBORN');
const branch = gitValue(['branch', '--show-current'], root, 'DETACHED');
const statusText = String(runGit(['status', '--short', '--untracked-files=all'], root).stdout);
const committedDiff = base ? String(runGit(['diff', '--binary', '--no-ext-diff', '--no-color', `${base}..HEAD`], root).stdout) : '';
const unstagedDiff = String(runGit(['diff', '--binary', '--no-ext-diff', '--no-color'], root).stdout);
const stagedDiff = String(runGit(['diff', '--cached', '--binary', '--no-ext-diff', '--no-color'], root).stdout);
const untracked = untrackedFiles(root).filter((relative) => path.resolve(root, relative) !== output);

function fenceFor(text) {
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(4, longest + 1));
}

async function renderUntracked(relative) {
  const absolute = path.join(root, ...relative.split('/'));
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) return `### ${relative}\n\nSymlink target: \`${await readlink(absolute)}\`\n`;
  if (!metadata.isFile()) return `### ${relative}\n\nNon-regular file; inspect directly.\n`;
  const data = await readFile(absolute);
  const hash = createHash('sha256').update(data).digest('hex');
  const binary = data.includes(0);
  if (binary || data.length > 512 * 1024) {
    return `### ${relative}\n\nBinary or large file; inspect directly. Size: ${data.length} bytes. SHA-256: \`${hash}\`.\n`;
  }
  const text = data.toString('utf8');
  const fence = fenceFor(text);
  return `### ${relative}\n\nSize: ${data.length} bytes. SHA-256: \`${hash}\`.\n\n${fence}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n`;
}

const sections = [
  '# Zimster Change Snapshot',
  '',
  `- Repository: \`${root}\``,
  `- Branch: \`${branch || 'DETACHED'}\``,
  `- Head: \`${head}\``,
  base ? `- Review base: \`${base}\`` : '- Review base: not supplied; committed branch range omitted',
  '',
  '## git status --short',
  '',
  '```text',
  statusText || '(clean)',
  '```',
  ''
];

for (const [title, content] of [
  ['Committed range', committedDiff],
  ['Staged diff (`git diff --cached`)', stagedDiff],
  ['Unstaged diff (`git diff`)', unstagedDiff]
]) {
  sections.push(`## ${title}`, '', '```diff', content || '(none)', '```', '');
}

sections.push('## Untracked files', '');
if (!untracked.length) sections.push('(none)', '');
else for (const relative of untracked) sections.push(await renderUntracked(relative), '');

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, sections.join('\n'), 'utf8');
console.log(output);
