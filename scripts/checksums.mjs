import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(process.argv[2] || path.join(root, 'dist'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const files = (await readdir(outputDirectory)).filter((name) => name.startsWith(`zimster-${version}-`) && name.endsWith('.zip')).sort();
if (!files.length) throw new Error(`no Zimster ${version} ZIP archives found in ${outputDirectory}`);
const lines = [];
for (const file of files) {
  const digest = createHash('sha256').update(await readFile(path.join(outputDirectory, file))).digest('hex');
  lines.push(`${digest}  ${file}`);
}
const output = path.join(outputDirectory, `zimster-${version}-SHA256SUMS.txt`);
await writeFile(output, `${lines.join('\n')}\n`);
console.log(path.relative(root, output));
