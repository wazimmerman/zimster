import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { runGit } from './lib/git-state.mjs';
import { readStoredZip } from './lib/zip-reader.mjs';
import { readTarGzip } from './lib/tar-reader.mjs';

const PATTERNS = Object.freeze([
  ['private_key', /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['live_secret_key', /\bsk_live_[A-Za-z0-9]{16,}\b/]
]);

const { options } = parseOptions(process.argv.slice(2));
const scanRoot = path.resolve(process.cwd(), String(options.root || '.'));
const dist = options.dist ? path.resolve(process.cwd(), String(options.dist)) : null;
const findings = [];

function inspect(source, file, data) {
  if (data.includes(0)) return;
  const text = data.toString('utf8');
  for (const [pattern, expression] of PATTERNS) {
    if (expression.test(text)) findings.push({ source, file, pattern });
  }
}

const worktreeFiles = runGit(
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  scanRoot,
  { encoding: 'buffer' }
)
  .stdout.toString('utf8').split('\0').filter(Boolean).sort();
for (const relative of worktreeFiles) {
  inspect('worktree', relative, await readFile(path.join(scanRoot, ...relative.split('/'))));
}

let archives = 0;
if (dist) {
  for (const name of (await readdir(dist)).filter((entry) => /\.(?:zip|tgz)$/.test(entry)).sort()) {
    archives += 1;
    const entries = name.endsWith('.tgz')
      ? await readTarGzip(path.join(dist, name))
      : await readStoredZip(path.join(dist, name));
    for (const entry of entries) {
      inspect('archive', `${name}:${entry.name}`, entry.data);
    }
  }
}

const summary = {
  schema_version: 1,
  status: findings.length ? 'failed' : 'passed',
  worktree_files: worktreeFiles.length,
  archives,
  findings
};
writeLine(JSON.stringify(summary));
if (findings.length) process.exitCode = 1;
