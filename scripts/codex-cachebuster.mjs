import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions } from './lib/cli.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const pluginRoot = positional[0];

if (!pluginRoot) {
  throw new Error('Usage: codex-cachebuster.mjs <plugin-root> [--cachebuster <token>]');
}

const manifestPath = path.resolve(pluginRoot, '.codex-plugin', 'plugin.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
  throw new Error(`${manifestPath} must contain a non-empty string version`);
}

const supplied = options.cachebuster
  ? String(options.cachebuster)
  : `local-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const cachebuster = supplied
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-{2,}/g, '-')
  .replace(/^-|-$/g, '');
if (!cachebuster) throw new Error('cachebuster must contain at least one letter or digit');

const previous = manifest.version;
const releaseVersion = previous.split('+', 1)[0];
manifest.version = `${releaseVersion}+codex.${cachebuster}`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${previous} -> ${manifest.version}`);
