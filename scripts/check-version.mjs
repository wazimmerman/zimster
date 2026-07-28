import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions } from './lib/cli.mjs';
import { assertSemver, root, versionRecords } from './lib/version-files.mjs';

const { options } = parseOptions(process.argv.slice(2));
const records = await versionRecords();
const canonical = records.find(([name]) => name === 'package.json')?.[1];
assertSemver(canonical);
const mismatches = records.filter(([, version]) => version !== canonical);
const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## ${canonical.replaceAll('.', '\\.')}(?:\\s|—|-)`, 'm').test(changelog)) {
  mismatches.push(['CHANGELOG.md', `missing ${canonical} heading`]);
}

if (options.tag !== undefined) {
  const tag = String(options.tag);
  const expected = `v${canonical}`;
  if (tag !== expected) mismatches.push([`release tag ${tag}`, `expected ${expected}`]);
}

if (mismatches.length) {
  console.error(`Version metadata does not match package.json ${canonical}:`);
  for (const [name, version] of mismatches) console.error(`- ${name}: ${version ?? 'missing'}`);
  process.exitCode = 1;
} else {
  console.log(`Version metadata is synchronized at ${canonical}${options.tag ? ` and matches ${options.tag}` : ''}.`);
}
