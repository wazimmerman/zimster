import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, writeLine } from './lib/cli.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { options } = parseOptions(process.argv.slice(2));
const configFile = path.resolve(
  process.cwd(),
  String(options.config || path.join(packageRoot, 'config', 'host-smoke.json'))
);
const config = JSON.parse(await readFile(configFile, 'utf8'));
if (config.schema_version !== 1 || !Array.isArray(config.hosts)) {
  throw new Error('host smoke config requires schema_version 1 and hosts');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-host-smoke-'));
const executed = [];
const unavailable = [];
const failures = [];

try {
  for (const host of config.hosts) {
    if (!host || typeof host.id !== 'string' || !host.id) {
      throw new Error('host smoke entries require id');
    }
    if (!host.command) {
      unavailable.push({
        id: host.id,
        reason: String(host.unavailable_reason || 'host smoke is not configured')
      });
      continue;
    }
    if (!Array.isArray(host.args || []) || !(host.args || []).every((arg) => typeof arg === 'string')) {
      throw new Error(`host ${host.id} args must be strings`);
    }
    const home = path.join(temporary, host.id);
    await mkdir(home, { recursive: true });
    const result = spawnSync(String(host.command), host.args || [], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        XDG_DATA_HOME: path.join(home, 'data'),
        CODEX_HOME: path.join(home, 'codex'),
        ...(host.env || {})
      }
    });
    if (result.status !== 0 || String(result.stderr || '').trim()) {
      failures.push({
        id: host.id,
        exit_code: result.status ?? 1,
        action: String(result.stderr || result.stdout || 'host smoke failed')
          .trim().split('\n').filter(Boolean).at(-1)
      });
      continue;
    }
    executed.push(host.id);
  }
  const summary = {
    schema_version: 1,
    status: failures.length ? 'failed' : 'passed',
    executed,
    unavailable,
    failures
  };
  writeLine(JSON.stringify(summary));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
