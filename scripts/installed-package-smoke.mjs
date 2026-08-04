import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { archivePathProblem, readStoredZip } from './lib/zip-reader.mjs';

const { options } = parseOptions(process.argv.slice(2));
const dist = path.resolve(process.cwd(), String(options.dist || 'dist'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-installed-package-'));
const targets = [];

async function extract(archive, destination) {
  for (const entry of await readStoredZip(archive)) {
    const problem = archivePathProblem(entry.name);
    if (problem) throw new Error(`${entry.name}: ${problem}`);
    const target = path.join(destination, ...entry.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
}

function isolatedEnvironment(home, additions = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    CODEX_HOME: path.join(home, 'codex'),
    ...additions
  };
}

function execute(file, args, cwd, env) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0 || String(result.stderr || '').trim()) {
    throw new Error(
      String(result.stderr || result.stdout || `command exited ${result.status}`).trim()
    );
  }
  return String(result.stdout || '').trim();
}

try {
  const archives = (await readdir(dist))
    .filter((name) => /^zimster-.*-(claude|codex|portable)\.zip$/.test(name))
    .sort();
  for (const target of ['claude', 'codex', 'portable']) {
    const name = archives.find((candidate) => candidate.endsWith(`-${target}.zip`));
    if (!name) throw new Error(`missing exact ${target} candidate archive`);
    const archive = path.join(dist, name);
    const extracted = path.join(temporary, target, 'package');
    const home = path.join(temporary, target, 'home');
    await mkdir(home, { recursive: true });
    await extract(archive, extracted);
    if (target === 'claude') {
      const output = execute(
        path.join(extracted, 'hooks', 'session-start.mjs'),
        [],
        extracted,
        isolatedEnvironment(home, {
          CLAUDE_PLUGIN_ROOT: extracted
        })
      );
      const payload = JSON.parse(output);
      if (!payload.hookSpecificOutput?.additionalContext?.includes('# Using Zimster')) {
        throw new Error('Claude installed hook did not load using-zimster');
      }
    }
    const packageRoot = target === 'codex'
      ? path.join(extracted, 'plugins', 'zimster')
      : extracted;
    JSON.parse(execute(
      path.join(packageRoot, 'scripts', 'model-routing.mjs'),
      ['validate-config', '--config', path.join(packageRoot, 'templates', 'zimster-config.json')],
      packageRoot,
      isolatedEnvironment(home)
    ));
    for (const contract of [
      'schemas/delegation-decision.schema.json',
      'schemas/model-proposal.schema.json',
      'schemas/routing-observation.schema.json',
      'schemas/convergence-decision.schema.json',
      'docs/INSTALL.md',
      'docs/CONFIGURATION.md',
      'docs/MIGRATING-0.5.0.md'
    ]) await readFile(path.join(packageRoot, contract));
    if (target !== 'claude') {
      JSON.parse(execute(
        path.join(packageRoot, 'scripts', 'doctor.mjs'),
        ['--json'],
        packageRoot,
        isolatedEnvironment(home)
      ));
      if (target === 'portable') {
        const metadata = JSON.parse(await readFile(
          path.join(packageRoot, 'skills', 'using-zimster', 'references', 'build-metadata.json'),
          'utf8'
        ));
        if (metadata.package_target !== 'portable') {
          throw new Error('portable build metadata does not identify the exact candidate');
        }
      }
    }
    const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
    targets.push({ target, status: 'passed', archive: name, sha256: hash });
  }
  writeLine(JSON.stringify({ schema_version: 1, status: 'passed', targets }));
} catch (error) {
  writeLine(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    targets,
    action: error.message
  }));
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
