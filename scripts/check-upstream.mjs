import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamVersion = '6.2.0';
const strict = process.argv.includes('--strict');
const url = 'https://raw.githubusercontent.com/obra/superpowers/main/package.json';

try {
  const response = await fetch(url, { headers: { 'user-agent': 'zimster-upstream-audit' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const current = await response.json();
  const local = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  console.log(`Zimster ${local.version} is based on Superpowers ${upstreamVersion}; upstream main reports ${current.version}.`);
  if (current.version !== upstreamVersion) {
    const message = `Review required: Superpowers advanced from ${upstreamVersion} to ${current.version}.`;
    if (strict) throw new Error(message);
    console.warn(message);
  }
} catch (error) {
  console.error(`Upstream audit failed: ${error.message}`);
  process.exitCode = 1;
}
