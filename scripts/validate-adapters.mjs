import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kimiFields = new Set([
  'name', 'version', 'description', 'keywords', 'author', 'homepage', 'license',
  'interface', 'skills', 'sessionStart', 'skillInstructions', 'mcpServers',
  'hooks', 'commands'
]);
const kimiInterfaceFields = new Set([
  'displayName', 'shortDescription', 'longDescription', 'developerName', 'websiteURL'
]);

async function present(root, relative) {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function read(root, relative, errors) {
  try {
    return await readFile(path.join(root, relative), 'utf8');
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return '';
  }
}

async function json(root, relative, errors) {
  const content = await read(root, relative, errors);
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return {};
  }
}

function unknownFields(object, allowed) {
  return Object.keys(object ?? {}).filter((field) => !allowed.has(field));
}

export async function validateSecondaryAdapters(root = defaultRoot) {
  const errors = [];
  if (await present(root, '.cursor-plugin/plugin.json')) {
    errors.push('.cursor-plugin/plugin.json: Cursor has no documented repository plugin manifest');
  }
  if (await present(root, 'hooks/hooks-cursor.json')) {
    errors.push('hooks/hooks-cursor.json: Cursor has no documented repository lifecycle-hook contract');
  }
  const cursorCommand = await read(root, '.cursor/commands/using-zimster.md', errors);
  if (cursorCommand && !/using-zimster/.test(cursorCommand)) {
    errors.push('.cursor/commands/using-zimster.md: must invoke the using-zimster skill');
  }
  if (cursorCommand && !/sync-skills/.test(cursorCommand)) {
    errors.push('.cursor/commands/using-zimster.md: must describe the supported skills refresh');
  }

  const pkg = await json(root, 'package.json', errors);
  const kimi = await json(root, '.kimi-plugin/plugin.json', errors);
  for (const field of unknownFields(kimi, kimiFields)) {
    errors.push(`.kimi-plugin/plugin.json: unsupported field ${field}`);
  }
  for (const field of unknownFields(kimi.interface, kimiInterfaceFields)) {
    errors.push(`.kimi-plugin/plugin.json: unsupported interface field ${field}`);
  }
  if (kimi.name !== 'zimster') errors.push('.kimi-plugin/plugin.json: expected name zimster');
  if (kimi.version !== pkg.version) errors.push('.kimi-plugin/plugin.json: version differs from package.json');
  if (kimi.license !== 'MIT') errors.push('.kimi-plugin/plugin.json: expected MIT license');
  if (kimi.skills !== './skills/') errors.push('.kimi-plugin/plugin.json: skills must resolve to ./skills/');
  if (kimi.sessionStart?.skill !== 'using-zimster') {
    errors.push('.kimi-plugin/plugin.json: sessionStart.skill must be using-zimster');
  }

  const expectedFiles = [
    'skills/using-zimster/SKILL.md',
    '.opencode/plugins/zimster.js',
    '.pi/extensions/zimster.ts',
    'docs/CURSOR.md',
    'docs/KIMI.md',
    'docs/OPENCODE.md',
    'docs/PI.md'
  ];
  for (const relative of expectedFiles) {
    if (!await present(root, relative)) errors.push(`${relative}: missing`);
  }

  if (pkg.main !== '.opencode/plugins/zimster.js') {
    errors.push('package.json: main must identify the OpenCode adapter');
  }
  if (!pkg.files?.includes('.cursor') || pkg.files?.includes('.cursor-plugin')) {
    errors.push('package.json: files must include .cursor and exclude .cursor-plugin');
  }
  if (JSON.stringify(pkg.pi?.extensions) !== JSON.stringify(['./.pi/extensions/zimster.ts'])) {
    errors.push('package.json: pi.extensions must contain the Zimster extension');
  }
  if (JSON.stringify(pkg.pi?.skills) !== JSON.stringify(['./skills'])) {
    errors.push('package.json: pi.skills must contain ./skills');
  }
  return errors;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const errors = await validateSecondaryAdapters();
  if (errors.length) {
    console.error(`Adapter validation failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Validated Cursor, Kimi Code, OpenCode, and Pi adapters.');
  }
}
