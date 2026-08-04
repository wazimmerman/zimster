import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitValue } from './git-state.mjs';

export const CONFIG_PRECEDENCE = Object.freeze([
  'explicit_dispatch_override',
  'per_run',
  'git_local_project',
  'user',
  'harness_native',
  'inherit'
]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestJson(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return structuredClone(override);
  const result = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

export function resolveUserConfigPath({
  platform = process.platform,
  env = process.env,
  home = os.homedir()
} = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, 'Zimster', 'config.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Zimster', 'config.json');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'zimster', 'config.json');
}

export function resolveProjectConfigPath(repoRoot) {
  const absolute = gitValue(
    ['rev-parse', '--path-format=absolute', '--git-path', 'zimster/config.json'],
    repoRoot,
    null
  );
  if (absolute) return absolute;
  const relative = gitValue(['rev-parse', '--git-path', 'zimster/config.json'], repoRoot, null);
  if (!relative) throw new Error('unable to resolve Git-local Zimster configuration path');
  return path.resolve(repoRoot, relative);
}

async function optionalJson(filePath, source) {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${source} configuration must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error(`${source} configuration is not valid JSON: ${filePath}`);
    throw error;
  }
}

export async function loadConfigLayers({
  explicitOverride = null,
  runPath = null,
  projectPath = null,
  userPath = null,
  harnessNative = null
} = {}) {
  const candidates = [
    { source: 'harness_native', value: harnessNative },
    { source: 'user', value: await optionalJson(userPath, 'user') },
    { source: 'git_local_project', value: await optionalJson(projectPath, 'project') },
    { source: 'per_run', value: await optionalJson(runPath, 'per-run') },
    { source: 'explicit_dispatch_override', value: explicitOverride }
  ];
  const layers = [];
  let effective = {};
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    effective = deepMerge(effective, candidate.value);
    layers.push({ source: candidate.source, digest: digestJson(candidate.value) });
  }
  return {
    precedence: [...CONFIG_PRECEDENCE],
    layers,
    effective,
    digest: digestJson(effective),
    fallback: layers.length ? null : 'inherit'
  };
}
