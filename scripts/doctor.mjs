import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

async function present(relative) {
  try { await access(path.join(root, relative)); return 'ready'; } catch { return 'missing'; }
}

const rows = [
  ['Codex', await present('.codex-plugin/plugin.json'), 'native skills; plugin deliberately declares hooks: {}'],
  ['Claude Code', await present('.claude-plugin/plugin.json'), 'native skills plus SessionStart bootstrap'],
  ['Cursor', await present('.cursor-plugin/plugin.json'), 'skills plus Cursor SessionStart hook'],
  ['Kimi Code', await present('.kimi-plugin/plugin.json'), 'native skills with explicit tool mapping'],
  ['OpenCode', await present('.opencode/plugins/zimster.js'), 'adapter registers skills and injects one bootstrap'],
  ['Pi', await present('.pi/extensions/zimster.ts'), 'extension registers skills; subagents remain optional']
];

console.log(`Zimster ${version}`);
console.log(`Host: ${os.platform()} ${os.release()} (${os.arch()})`);
console.log(`Node: ${process.version}`);
console.log('');
for (const [name, status, note] of rows) console.log(`${name.padEnd(13)} ${status.padEnd(7)} ${note}`);
console.log('');
console.log('Run npm run check before publishing. Use the portable archive for source installs, or the harness-specific archive where supported.');
