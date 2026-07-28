import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { writeLine } from './lib/cli.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const instructions = [];
const commands = [];

async function exists(file) {
  try { return (await stat(path.join(root, file))).isFile(); } catch { return false; }
}

for (const file of ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md']) {
  if (await exists(file)) instructions.push(file);
}

if (await exists('package.json')) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const [name, definition] of Object.entries(packageJson.scripts || {})) {
    const command = ['test', 'start', 'stop', 'restart'].includes(name) ? `npm ${name}` : `npm run ${name}`;
    commands.push({ source: 'package.json', name, command, definition, priority: 2 });
  }
}

for (const makefile of ['Makefile', 'makefile']) {
  if (!await exists(makefile)) continue;
  const content = await readFile(path.join(root, makefile), 'utf8');
  for (const match of content.matchAll(/^([A-Za-z0-9_.-]+):(?:\s|$)/gm)) {
    if (!match[1].startsWith('.')) commands.push({ source: makefile, name: match[1], command: `make ${match[1]}`, priority: 3 });
  }
}

if (await exists('justfile')) {
  const content = await readFile(path.join(root, 'justfile'), 'utf8');
  for (const match of content.matchAll(/^([A-Za-z0-9_-]+):(?:\s|$)/gm)) {
    commands.push({ source: 'justfile', name: match[1], command: `just ${match[1]}`, priority: 3 });
  }
}

for (const taskfile of ['Taskfile.yml', 'Taskfile.yaml']) {
  if (!await exists(taskfile)) continue;
  const content = await readFile(path.join(root, taskfile), 'utf8');
  const tasksBlock = content.match(/^tasks:\s*\n([\s\S]*)$/m)?.[1] || '';
  for (const match of tasksBlock.matchAll(/^  ([A-Za-z0-9_.-]+):(?:\s|$)/gm)) {
    commands.push({ source: taskfile, name: match[1], command: `task ${match[1]}`, priority: 3 });
  }
}

const workflows = path.join(root, '.github', 'workflows');
try {
  for (const entry of await readdir(workflows, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const relative = path.posix.join('.github/workflows', entry.name);
    const content = await readFile(path.join(workflows, entry.name), 'utf8');
    for (const match of content.matchAll(/^\s*-?\s*run:\s*([^|>].+)$/gm)) {
      commands.push({ source: relative, name: 'ci-run', command: match[1].trim(), priority: 4 });
    }
  }
} catch {
  // No GitHub Actions directory.
}

for (const file of ['Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts']) {
  if (await exists(file)) {
    commands.push({ source: file, name: 'repository-tooling', command: null, priority: 2, note: `Inspect ${file} and repository instructions before inventing flags.` });
  }
}

commands.sort((a, b) => a.priority - b.priority || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
writeLine(JSON.stringify({
  root,
  instructions,
  selection_rule: 'Use repository instructions first, then package/language scripts, task runners, and CI. Invent flags only when canonical commands are insufficient.',
  commands
}, null, 2));
