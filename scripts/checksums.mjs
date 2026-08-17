import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv[2] === '--check';
const outputDirectory = path.resolve((check ? process.argv[3] : process.argv[2]) || path.join(root, 'dist'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const files = (await readdir(outputDirectory)).filter((name) => (
  (name.startsWith(`zimster-${version}-`) && name.endsWith('.zip'))
  || name === `zimster-${version}.tgz`
)).sort();
if (!files.length) throw new Error(`no Zimster ${version} archives found in ${outputDirectory}`);
const lines = [];
for (const file of files) {
  const digest = createHash('sha256').update(await readFile(path.join(outputDirectory, file))).digest('hex');
  lines.push(`${digest}  ${file}`);
}
const output = path.join(outputDirectory, `zimster-${version}-SHA256SUMS.txt`);
if (check) {
  const recorded = (await readFile(output, 'utf8')).trim().split('\n').filter(Boolean);
  if (JSON.stringify(recorded) !== JSON.stringify(lines)) {
    throw new Error(`checksum mismatch for Zimster ${version} artifacts`);
  }
  console.log(`verified ${files.length} checksums`);
} else {
  await writeFile(output, `${lines.join('\n')}\n`);
  console.log(path.relative(root, output));
}
