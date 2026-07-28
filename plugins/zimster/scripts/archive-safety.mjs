import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { archivePathProblem, readStoredZip } from './lib/zip-reader.mjs';

const { options } = parseOptions(process.argv.slice(2));
const directory = path.resolve(process.cwd(), String(options.dist || 'dist'));
const archives = (await readdir(directory))
  .filter((name) => name.endsWith('.zip'))
  .sort();
if (!archives.length) throw new Error(`no ZIP archives found in ${directory}`);

const violations = [];
let entries = 0;
for (const archive of archives) {
  try {
    for (const entry of await readStoredZip(path.join(directory, archive))) {
      entries += 1;
      const problem = archivePathProblem(entry.name);
      if (problem) violations.push(`${archive}: ${entry.name}: ${problem}`);
      const segments = entry.name.split('/');
      if (segments.includes('.git') || segments.includes('node_modules') || segments.includes('.zimster')) {
        violations.push(`${archive}: ${entry.name}: forbidden operational path`);
      }
    }
  } catch (error) {
    violations.push(`${archive}: ${error.message}`);
  }
}

const summary = {
  schema_version: 1,
  status: violations.length ? 'failed' : 'passed',
  archives: archives.length,
  entries,
  violations
};
writeLine(JSON.stringify(summary));
if (violations.length) process.exitCode = 1;
