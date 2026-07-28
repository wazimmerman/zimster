import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';
import { versionRecords } from './lib/version-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

async function present(relative) {
  try { await access(path.join(root, relative)); return 'ready'; } catch { return 'missing'; }
}

const versionMismatch = (await versionRecords()).filter(([, value]) => value !== version);
const mirrorDifferences = await syncCodexPlugin({ check: true });
const rows = [
  ['Codex', await present('plugins/zimster/.codex-plugin/plugin.json'), 'repo marketplace → local plugins/zimster; no Claude hook field'],
  ['Claude Code', await present('.claude-plugin/plugin.json'), 'native skills plus compact SessionStart bootstrap'],
  ['Cursor', await present('.cursor-plugin/plugin.json'), 'skills plus Cursor SessionStart hook'],
  ['Kimi Code', await present('.kimi-plugin/plugin.json'), 'native skills with explicit tool mapping'],
  ['OpenCode', await present('.opencode/plugins/zimster.js'), 'adapter registers skills and injects one bootstrap'],
  ['Pi', await present('.pi/extensions/zimster.ts'), 'extension registers skills; subagents remain optional'],
  ['Operational', await present('scripts/evidence.mjs'), 'change snapshots, evidence receipts, dispatch records, and run state']
];

console.log(`Zimster ${version}`);
console.log(`Host: ${os.platform()} ${os.release()} (${os.arch()})`);
console.log(`Node: ${process.version}`);
console.log('');
for (const [name, status, note] of rows) console.log(`${name.padEnd(13)} ${status.padEnd(7)} ${note}`);
console.log('');
console.log(`Version metadata: ${versionMismatch.length ? `${versionMismatch.length} mismatch(es)` : 'synchronized'}`);
console.log(`Codex mirror: ${mirrorDifferences.length ? `${mirrorDifferences.length} difference(s)` : 'current'}`);
console.log('Run npm run check before publishing. A structural doctor result is not a live harness installation test.');
