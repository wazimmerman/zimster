import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodexContract, validateCodexPlugin, validateRepoMarketplace } from './lib/codex-plugin-contract.mjs';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';
import { versionRecords } from './lib/version-files.mjs';
import { validateClaudePlugin } from './lib/claude-plugin-contract.mjs';
import { validateSecondaryAdapters } from './validate-adapters.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const requiredManifests = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.kimi-plugin/plugin.json'];
const portableManifestFields = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'extensions'
]);

async function read(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function parseJson(relative) {
  try { return JSON.parse(await read(relative)); }
  catch (error) { errors.push(`${relative}: ${error.message}`); return {}; }
}

function frontmatter(content, relative) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) { errors.push(`${relative}: missing frontmatter`); return {}; }
  const values = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const packageJson = await parseJson('package.json');
const portableManifest = await parseJson('plugin.json');
if (portableManifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') errors.push('plugin.json: expected Agent Plugins 1.0.0 schema');
if (portableManifest.name !== 'zimster') errors.push('plugin.json: expected name zimster');
if (portableManifest.version !== packageJson.version) errors.push('plugin.json: version differs from package.json');
if (portableManifest.homepage !== 'https://zimster.dev') errors.push('plugin.json: expected canonical homepage https://zimster.dev');
for (const key of Object.keys(portableManifest)) {
  if (!portableManifestFields.has(key)) errors.push(`plugin.json: unsupported Agent Plugins field ${key}`);
}
const standardsLock = await parseJson('config/standards-lock.json');
if (standardsLock.agent_plugins?.commit !== '1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1') errors.push('config/standards-lock.json: Agent Plugins revision is not pinned');
if (standardsLock.agent_skills?.commit !== '217be548739f21d6008915c29aefe320ea1a90af') errors.push('config/standards-lock.json: Agent Skills revision is not pinned');
const versionRows = await versionRecords();
for (const [name, version] of versionRows) {
  if (version !== packageJson.version) errors.push(`${name}: version ${version ?? 'missing'} differs from package.json ${packageJson.version}`);
}
const changelog = await read('CHANGELOG.md');
if (!new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}(?:\\s|—|-)`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md: missing release heading for ${packageJson.version}`);
}

for (const file of requiredManifests) {
  const manifest = await parseJson(file);
  if (manifest.name !== 'zimster') errors.push(`${file}: expected name zimster`);
  if (manifest.version !== packageJson.version) errors.push(`${file}: version differs from package.json`);
  if (manifest.license !== 'MIT') errors.push(`${file}: expected MIT license`);
}
if (packageJson.dependencies && Object.keys(packageJson.dependencies).length) errors.push('package.json: runtime dependencies are not permitted without an explicit architecture decision');

const skillsDir = path.join(root, 'skills');
const skillNames = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const name of skillNames) {
  const relative = `skills/${name}/SKILL.md`;
  const content = await read(relative);
  const metadata = frontmatter(content, relative);
  if (metadata.name !== name) errors.push(`${relative}: frontmatter name does not match directory`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name || '') || (metadata.name || '').length > 64) errors.push(`${relative}: name violates Agent Skills constraints`);
  if (!metadata.description || metadata.description.length < 20) errors.push(`${relative}: description is missing or too short`);
  if ((metadata.description || '').length > 1024 || /[<>]/.test(metadata.description || '')) errors.push(`${relative}: description violates Agent Skills constraints`);
  if (/`scripts\//.test(content)) errors.push(`${relative}: helper path must be rooted at <zimster> with a skills-only fallback`);
  const lines = content.split('\n').length;
  if (lines > 240) errors.push(`${relative}: ${lines} lines exceeds the 240-line budget`);
  for (const forbidden of ['/tmp/', '/home/', 'C:\\Users\\', '~/.']) {
    if (content.includes(forbidden)) errors.push(`${relative}: core skill contains platform-specific path ${forbidden}`);
  }

  const openaiRelative = `skills/${name}/agents/openai.yaml`;
  let metadataText = '';
  try { metadataText = await read(openaiRelative); }
  catch { errors.push(`${openaiRelative}: missing`); }
  if (metadataText && !/^interface:\n/m.test(metadataText)) errors.push(`${openaiRelative}: missing interface block`);
  const shortDescription = metadataText.match(/short_description:\s*"([^"]+)"/)?.[1] ?? '';
  if (metadataText && (shortDescription.length < 25 || shortDescription.length > 64)) errors.push(`${openaiRelative}: short_description must be 25-64 characters`);
  if (metadataText && !new RegExp(`default_prompt:.*\\$${name}(?:\\s|[^a-z0-9-])`).test(metadataText)) errors.push(`${openaiRelative}: default_prompt must mention the $${name} skill`);
}

const contract = await loadCodexContract(root);
for (const error of await validateCodexPlugin(path.join(root, 'plugins', 'zimster'), contract)) errors.push(`Codex plugin: ${error}`);
for (const error of await validateRepoMarketplace(root)) errors.push(`Codex marketplace: ${error}`);
for (const difference of await syncCodexPlugin({ check: true })) errors.push(`Codex mirror: ${difference}`);
for (const error of await validateClaudePlugin(root)) errors.push(`Claude plugin: ${error}`);
for (const error of await validateSecondaryAdapters(root)) errors.push(`Secondary adapter: ${error}`);

for (const [agent, allowBash] of [['scout', false], ['integration-reviewer', false], ['test-reviewer', true]]) {
  const content = await read(`agents/${agent}.md`);
  const tools = content.match(/^tools:\s*(.+)$/m)?.[1] ?? '';
  if (!allowBash && /\bBash\b/.test(tools)) errors.push(`agents/${agent}.md: pure read-only role must not expose Bash`);
  if (allowBash && !/\bBash\b/.test(tools)) errors.push(`agents/${agent}.md: test-capable role must expose Bash`);
}

for (const relative of [
  'plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/CLAUDE.md',
  'docs/DIAGNOSTICS.md', 'docs/EVALUATION.md', 'docs/OPERATIONS.md',
  'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/KNOWN_LIMITATIONS.md',
  'docs/MIGRATING-0.5.0.md',
  'docs/RELEASING.md', 'docs/RESEARCH.md', 'docs/SKILLS_ONLY.md',
  'docs/UPSTREAM.md',
  'scripts/evidence.mjs', 'scripts/change-snapshot.mjs', 'scripts/delegation-record.mjs',
  'scripts/model-routing.mjs', 'scripts/dispatch-record.mjs',
  'scripts/adapter-config.mjs',
  'scripts/convergence.mjs',
  'scripts/verify.mjs', 'scripts/archive-safety.mjs', 'scripts/secret-scan.mjs',
  'scripts/installed-package-smoke.mjs', 'scripts/host-smoke.mjs',
  'scripts/review-package.mjs', 'scripts/capability-cache.mjs',
  'scripts/semantic-assurance.mjs', 'scripts/lib/semantic-assurance.mjs',
  'scripts/lib/evidence-validity.mjs', 'scripts/lib/config-layers.mjs',
  'scripts/lib/model-routing.mjs',
  'scripts/lib/proposal-state.mjs',
  'scripts/lib/convergence.mjs',
  'scripts/run-postmortem.mjs', 'scripts/evaluate-execution-economy.mjs',
  'docs/evaluations/v0.3.0-hardening-postmortem.md',
  'scripts/check-version.mjs', 'scripts/bump-version.mjs', 'scripts/checksums.mjs', 'config/model-routing.json',
  'config/host-smoke.json', 'config/standards-lock.json', 'config/pi-delegation.json',
  'schemas/evidence.schema.json', 'schemas/dispatch.schema.json',
  'schemas/delegation-decision.schema.json', 'schemas/model-proposal.schema.json',
  'schemas/zimster-config.schema.json', 'schemas/routing-observation.schema.json',
  'schemas/convergence-decision.schema.json', 'config/convergence.json',
  'schemas/host-smoke-receipt.schema.json',
  'schemas/binding-requirements.schema.json',
  'schemas/requirement-matrix.schema.json',
  'schemas/semantic-review.schema.json', 'schemas/review-records.schema.json',
  'schemas/completion-decision.schema.json',
  'templates/binding-requirements.json', 'templates/requirement-matrix.json',
  'templates/zimster-config.json', 'templates/delegation-decision.json',
  'templates/model-proposal.json'
]) {
  try { if (!(await stat(path.join(root, relative))).isFile()) errors.push(`${relative}: not a file`); }
  catch { errors.push(`${relative}: missing`); }
}

const notices = await read('THIRD_PARTY_NOTICES.md');
if (!notices.includes('Copyright (c) 2025 Jesse Vincent')) errors.push('THIRD_PARTY_NOTICES.md: missing Superpowers copyright');
if (!/OpenAI Codex plugin contract/i.test(notices) || !/Apache License 2\.0/i.test(notices)) errors.push('THIRD_PARTY_NOTICES.md: missing OpenAI Codex contract notice');
if (!/Agent Plugins specification/i.test(notices) || !/Agent Skills specification/i.test(notices)) errors.push('THIRD_PARTY_NOTICES.md: missing standards attribution');

if (errors.length) {
  console.error(`Validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated Zimster ${packageJson.version}: ${skillNames.length} skills, ${requiredManifests.length} primary manifests, current Codex mirror, synchronized release metadata, zero runtime dependencies.`);
}
