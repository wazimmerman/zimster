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
  harnessNative = null,
  harnessPath = null
} = {}) {
  const candidates = [
    { source: 'harness_native', value: harnessNative, path: harnessPath },
    { source: 'user', value: await optionalJson(userPath, 'user'), path: userPath },
    { source: 'git_local_project', value: await optionalJson(projectPath, 'project'), path: projectPath },
    { source: 'per_run', value: await optionalJson(runPath, 'per-run'), path: runPath },
    { source: 'explicit_dispatch_override', value: explicitOverride }
  ];
  const layers = [];
  const layerEvidence = [];
  const mappingSources = {};
  let effective = {};
  for (const candidate of candidates) {
    if (candidate.path) {
      layerEvidence.push({
        source: candidate.source,
        path: candidate.path,
        digest: candidate.value ? digestJson(candidate.value) : 'absent'
      });
    }
    if (!candidate.value) continue;
    effective = deepMerge(effective, candidate.value);
    for (const capabilityClass of Object.keys(candidate.value.routing?.mappings || {})) {
      mappingSources[capabilityClass] = candidate.source;
    }
    layers.push({
      source: candidate.source,
      ...(candidate.path ? { path: candidate.path } : {}),
      digest: digestJson(candidate.value),
      routing_keys: Object.keys(candidate.value.routing || {}).sort(),
      has_mappings: Object.keys(candidate.value.routing?.mappings || {}).length > 0
    });
  }
  return {
    precedence: [...CONFIG_PRECEDENCE],
    layers,
    layer_evidence: layerEvidence,
    mapping_sources: mappingSources,
    effective,
    digest: digestJson(effective),
    fallback: layers.length ? null : 'inherit'
  };
}
