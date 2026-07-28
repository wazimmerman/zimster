import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required } from './lib/cli.mjs';
import { assertSemver, root, updateVersionFiles } from './lib/version-files.mjs';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';

const { options, positional } = parseOptions(process.argv.slice(2));
const version = options.version ? required(options, 'version') : positional[0];
if (!version) throw new Error('Usage: bump-version.mjs <semver> --note "release summary" [--date YYYY-MM-DD]');
assertSemver(String(version));
const note = required(options, 'note');
const date = String(options.date || new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');

const changelogPath = path.join(root, 'CHANGELOG.md');
let changelog = await readFile(changelogPath, 'utf8');
const heading = `## ${version} — ${date}`;
if (!new RegExp(`^## ${String(version).replaceAll('.', '\\.')}(?:\\s|—|-)`, 'm').test(changelog)) {
  changelog = changelog.replace(/^# Changelog\s*\n/, `# Changelog\n\n${heading}\n\n- ${note}\n\n`);
  await writeFile(changelogPath, changelog);
}

await updateVersionFiles(String(version));
await syncCodexPlugin();
console.log(`Updated Zimster version metadata, changelog, and Codex mirror to ${version}.`);
