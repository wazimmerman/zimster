import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const HEX = /^#[0-9A-F]{6}$/i;
const INTERFACE_ALLOWED = new Set([
  'displayName', 'shortDescription', 'longDescription', 'developerName',
  'category', 'capabilities', 'websiteURL', 'privacyPolicyURL',
  'termsOfServiceURL', 'brandColor', 'composerIcon', 'logo', 'logoDark',
  'screenshots', 'defaultPrompt', 'default_prompt'
]);
const AUTHOR_ALLOWED = new Set(['name', 'email', 'url']);

async function loadJson(file, errors, label = file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${label} must contain a JSON object`);
      return null;
    }
    return value;
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDefaultPrompt(value) {
  if (nonEmpty(value)) return true;
  return Array.isArray(value) && value.length > 0 && value.length <= 3
    && value.every((prompt) => nonEmpty(prompt) && prompt.length <= 128);
}

function validateHttps(value, field, errors) {
  if (value === undefined) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.host) throw new Error('not https');
  } catch {
    errors.push(`${field} must be an absolute https:// URL`);
  }
}

function rejectUnknown(object, allowed, prefix, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) errors.push(`${prefix}.${key} is not accepted by Codex plugin validation`);
  }
}

function normalizeContractPath(value) {
  if (!nonEmpty(value) || path.isAbsolute(value)) return null;
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

async function fileExists(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function dirExists(file) {
  try { return (await stat(file)).isDirectory(); } catch { return false; }
}

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

async function validateSkills(pluginRoot, errors) {
  const skillsRoot = path.join(pluginRoot, 'skills');
  if (!await dirExists(skillsRoot)) return;
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!await fileExists(skillFile)) {
      errors.push(`skill ${entry.name} is missing SKILL.md`);
      continue;
    }
    const metadata = parseSkillFrontmatter(await readFile(skillFile, 'utf8'));
    if (!metadata) {
      errors.push(`skill ${entry.name} must start with YAML frontmatter`);
      continue;
    }
    if (!nonEmpty(metadata.name)) errors.push(`skill ${entry.name} frontmatter name must be non-empty`);
    if (!nonEmpty(metadata.description)) errors.push(`skill ${entry.name} frontmatter description must be non-empty`);
    if (metadata['disable-model-invocation'] && metadata['disable-model-invocation'] !== 'false') {
      errors.push(`skill ${entry.name} disable-model-invocation must be false`);
    }
  }
}

async function validateAsset(pluginRoot, rawPath, field, errors) {
  if (rawPath === undefined) return;
  if (!nonEmpty(rawPath) || path.isAbsolute(rawPath)) {
    errors.push(`${field} must be a relative asset path`);
    return;
  }
  const relative = rawPath.replace(/^\.\//, '');
  const resolved = path.resolve(pluginRoot, relative);
  if (!resolved.startsWith(`${path.resolve(pluginRoot)}${path.sep}`) || !await fileExists(resolved)) {
    errors.push(`${field} points to a missing or external asset: ${rawPath}`);
  }
}

export async function validateCodexPlugin(pluginRoot, contract) {
  const errors = [];
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  const manifest = await loadJson(manifestPath, errors, '.codex-plugin/plugin.json');
  if (!manifest) return errors;

  const allowed = new Set(contract.manifest_allowed_keys);
  for (const key of Object.keys(manifest)) {
    if (!allowed.has(key)) errors.push(`plugin.json field ${key} is not accepted by Codex plugin validation`);
  }
  for (const field of ['name', 'version', 'description']) {
    if (!nonEmpty(manifest[field])) errors.push(`plugin.json field ${field} must be a non-empty string`);
  }
  if (nonEmpty(manifest.version) && !SEMVER.test(manifest.version)) errors.push('plugin.json version must be strict semver');

  if (!manifest.author || typeof manifest.author !== 'object' || Array.isArray(manifest.author)) {
    errors.push('plugin.json author must be an object');
  } else {
    rejectUnknown(manifest.author, AUTHOR_ALLOWED, 'author', errors);
    if (!nonEmpty(manifest.author.name)) errors.push('plugin.json author.name must be non-empty');
    validateHttps(manifest.author.url, 'plugin.json author.url', errors);
  }

  if (manifest.skills !== undefined && normalizeContractPath(manifest.skills) !== 'skills') {
    errors.push('plugin.json skills must resolve to skills');
  }
  if (manifest.skills !== undefined && !await dirExists(path.join(pluginRoot, 'skills'))) {
    errors.push('plugin.json skills path does not exist');
  }

  const interfaceBlock = manifest.interface;
  if (!interfaceBlock || typeof interfaceBlock !== 'object' || Array.isArray(interfaceBlock)) {
    errors.push('plugin.json interface must be an object');
  } else {
    rejectUnknown(interfaceBlock, INTERFACE_ALLOWED, 'interface', errors);
    for (const field of contract.interface_required_fields) {
      if (field === 'capabilities') continue;
      if (!nonEmpty(interfaceBlock[field])) errors.push(`plugin.json interface.${field} must be a non-empty string`);
    }
    if (!Array.isArray(interfaceBlock.capabilities) || !interfaceBlock.capabilities.every(nonEmpty)) {
      errors.push('plugin.json interface.capabilities must be an array of strings');
    }
    if (!validDefaultPrompt(interfaceBlock.defaultPrompt) && !validDefaultPrompt(interfaceBlock.default_prompt)) {
      errors.push('plugin.json interface.defaultPrompt or default_prompt is required');
    }
    for (const field of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
      validateHttps(interfaceBlock[field], `plugin.json interface.${field}`, errors);
    }
    if (interfaceBlock.brandColor !== undefined && (!nonEmpty(interfaceBlock.brandColor) || !HEX.test(interfaceBlock.brandColor))) {
      errors.push('plugin.json interface.brandColor must use #RRGGBB');
    }
    for (const field of ['composerIcon', 'logo', 'logoDark']) {
      await validateAsset(pluginRoot, interfaceBlock[field], `plugin.json interface.${field}`, errors);
    }
    if (interfaceBlock.screenshots !== undefined) {
      if (!Array.isArray(interfaceBlock.screenshots)) errors.push('plugin.json interface.screenshots must be an array');
      else for (let index = 0; index < interfaceBlock.screenshots.length; index += 1) {
        await validateAsset(pluginRoot, interfaceBlock.screenshots[index], `plugin.json interface.screenshots[${index}]`, errors);
      }
    }
  }

  await validateSkills(pluginRoot, errors);
  return errors;
}

export async function validateRepoMarketplace(repoRoot, pluginName = 'zimster') {
  const errors = [];
  const marketplacePath = path.join(repoRoot, '.agents', 'plugins', 'marketplace.json');
  const marketplace = await loadJson(marketplacePath, errors, '.agents/plugins/marketplace.json');
  if (!marketplace) return errors;
  if (!nonEmpty(marketplace.name)) errors.push('marketplace name must be a non-empty string');
  if (!Array.isArray(marketplace.plugins)) {
    errors.push('marketplace plugins must be an array');
    return errors;
  }
  const entry = marketplace.plugins.find((item) => item && item.name === pluginName);
  if (!entry) {
    errors.push(`marketplace is missing plugin ${pluginName}`);
    return errors;
  }
  if (entry.source?.source !== 'local') errors.push('marketplace plugin source.source must be local');
  if (entry.source?.path !== `./plugins/${pluginName}`) errors.push(`marketplace plugin source.path must be ./plugins/${pluginName}`);
  if (!entry.policy || !nonEmpty(entry.policy.installation) || !nonEmpty(entry.policy.authentication)) {
    errors.push('marketplace plugin policy must include installation and authentication');
  }
  if (!nonEmpty(entry.category)) errors.push('marketplace plugin category must be non-empty');
  if (!await dirExists(path.join(repoRoot, 'plugins', pluginName))) errors.push(`marketplace plugin directory plugins/${pluginName} is missing`);
  return errors;
}

export async function loadCodexContract(repoRoot) {
  return JSON.parse(await readFile(path.join(repoRoot, 'vendor', 'openai-codex-plugin-validator', 'manifest-contract.json'), 'utf8'));
}
