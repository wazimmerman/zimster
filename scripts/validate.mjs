import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const requiredManifests = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.kimi-plugin/plugin.json'];

async function read(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function parseJson(relative) {
  try {
    return JSON.parse(await read(relative));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return {};
  }
}

function frontmatter(content, relative) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${relative}: missing frontmatter`);
    return {};
  }
  const values = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const packageJson = await parseJson('package.json');
for (const file of requiredManifests) {
  const manifest = await parseJson(file);
  if (manifest.name !== 'zimster') errors.push(`${file}: expected name zimster`);
  if (manifest.version !== packageJson.version) errors.push(`${file}: version differs from package.json`);
  if (manifest.license !== 'MIT') errors.push(`${file}: expected MIT license`);
}

const skillsDir = path.join(root, 'skills');
const skillNames = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const name of skillNames) {
  const relative = `skills/${name}/SKILL.md`;
  const content = await read(relative);
  const metadata = frontmatter(content, relative);
  if (metadata.name !== name) errors.push(`${relative}: frontmatter name does not match directory`);
  if (!metadata.description || metadata.description.length < 20) errors.push(`${relative}: description is missing or too short`);
  const lines = content.split('\n').length;
  if (lines > 240) errors.push(`${relative}: ${lines} lines exceeds the 240-line budget`);
  for (const forbidden of ['/tmp/', '/home/', 'C:\\Users\\', '~/.']) {
    if (content.includes(forbidden)) errors.push(`${relative}: core skill contains platform-specific path ${forbidden}`);
  }

  const openaiRelative = `skills/${name}/agents/openai.yaml`;
  let openaiMetadata = '';
  try {
    openaiMetadata = await read(openaiRelative);
  } catch {
    errors.push(`${openaiRelative}: missing`);
  }
  if (openaiMetadata && !/^interface:\n/m.test(openaiMetadata)) errors.push(`${openaiRelative}: missing interface block`);
  const shortDescription = openaiMetadata.match(/short_description:\s*"([^"]+)"/)?.[1] ?? '';
  if (openaiMetadata && (shortDescription.length < 25 || shortDescription.length > 64)) {
    errors.push(`${openaiRelative}: short_description must be 25-64 characters`);
  }
  if (openaiMetadata && !new RegExp(`default_prompt:.*\\$${name}(?:\\s|[^a-z0-9-])`).test(openaiMetadata)) {
    errors.push(`${openaiRelative}: default_prompt must mention the $${name} skill`);
  }
}

const codex = await parseJson('.codex-plugin/plugin.json');
if (codex.skills !== './skills/') errors.push('.codex-plugin/plugin.json: skills must be ./skills/');
if (JSON.stringify(codex.hooks) !== '{}') errors.push('.codex-plugin/plugin.json: hooks must be an explicit empty object');

for (const relative of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/EVALUATION.md', 'docs/RESEARCH.md', 'docs/UPSTREAM.md']) {
  try {
    const metadata = await stat(path.join(root, relative));
    if (!metadata.isFile()) errors.push(`${relative}: not a file`);
  } catch {
    errors.push(`${relative}: missing`);
  }
}

const notices = await read('THIRD_PARTY_NOTICES.md');
if (!notices.includes('Copyright (c) 2025 Jesse Vincent')) errors.push('THIRD_PARTY_NOTICES.md: missing Superpowers copyright');

if (errors.length) {
  console.error(`Validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated Zimster ${packageJson.version}: ${skillNames.length} skills, ${requiredManifests.length} primary manifests, zero runtime dependencies.`);
}
