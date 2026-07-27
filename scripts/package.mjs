import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, createZip } from './lib/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const common = ['skills', 'agents', 'templates', 'assets', 'docs', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md', 'SUPPORT.md', 'CHANGELOG.md', 'package.json'];
const exclusions = ['dist', '.git', 'node_modules', '.zimster/runtime'];

export async function createPackages(outputDirectory = path.join(root, 'dist')) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await rm(outputDirectory, { recursive: true, force: true });

  const definitions = [
    ['claude', ['.claude-plugin', 'hooks', ...common]],
    ['codex', ['.codex-plugin', '.agents', ...common]],
    ['portable', ['.agents', '.claude-plugin', '.codex-plugin', '.cursor-plugin', '.kimi-plugin', '.opencode', '.pi', 'hooks', 'scripts', ...common]]
  ];

  const outputs = [];
  for (const [target, includes] of definitions) {
    const entries = await collectFiles(root, includes, exclusions);
    const output = path.join(outputDirectory, `zimster-${version}-${target}.zip`);
    await createZip(output, entries);
    outputs.push(output);
  }
  return outputs;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outputs = await createPackages();
  for (const output of outputs) console.log(path.relative(root, output));
}
