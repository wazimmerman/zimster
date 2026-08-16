import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const manifestFields = new Set([
  'name', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords'
]);
const agentFields = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'maxTurns',
  'skills', 'memory', 'background', 'effort', 'isolation', 'color', 'initialPrompt',
  'subagents'
]);
const ignoredPluginAgentFields = new Set(['permissionMode', 'hooks', 'mcpServers']);

async function json(file, label, errors) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return {};
  }
}

function frontmatter(content, label, errors) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${label}: missing YAML frontmatter`);
    return {};
  }
  const result = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      errors.push(`${label}: unsupported multiline or malformed frontmatter`);
      continue;
    }
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function fields(object, allowed, label, errors) {
  for (const field of Object.keys(object)) {
    if (!allowed.has(field)) errors.push(`${label}: unsupported field ${field}`);
  }
}

function csv(value = '') {
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

export async function validateClaudePlugin(root) {
  const errors = [];
  const manifest = await json(
    path.join(root, '.claude-plugin', 'plugin.json'),
    '.claude-plugin/plugin.json',
    errors
  );
  fields(manifest, manifestFields, '.claude-plugin/plugin.json', errors);
  if (manifest.name !== 'zimster') errors.push('.claude-plugin/plugin.json: name must be zimster');
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) {
    errors.push('.claude-plugin/plugin.json: version must be semantic');
  }
  const marketplace = await json(
    path.join(root, '.claude-plugin', 'marketplace.json'),
    '.claude-plugin/marketplace.json',
    errors
  );
  fields(
    marketplace,
    new Set(['$schema', 'name', 'description', 'version', 'owner', 'plugins', 'metadata', 'renames']),
    '.claude-plugin/marketplace.json',
    errors
  );
  if (marketplace.name !== 'zimster') errors.push('.claude-plugin/marketplace.json: name must be zimster');
  if (!marketplace.description) errors.push('.claude-plugin/marketplace.json: description is required for warning-free validation');
  if (!marketplace.owner?.name) errors.push('.claude-plugin/marketplace.json: owner.name is required');
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const zimsterEntry = entries.find((entry) => entry.name === 'zimster');
  if (entries.length !== 1 || !zimsterEntry) {
    errors.push('.claude-plugin/marketplace.json: expected exactly one zimster entry');
  } else {
    if (!['.', './'].includes(zimsterEntry.source)) {
      errors.push('.claude-plugin/marketplace.json: local source must resolve to the marketplace root');
    }
    if (zimsterEntry.version !== manifest.version) {
      errors.push('.claude-plugin/marketplace.json: entry version must match plugin manifest');
    }
  }

  const hooks = await json(path.join(root, 'hooks', 'hooks.json'), 'hooks/hooks.json', errors);
  const sessionStarts = hooks.hooks?.SessionStart;
  if (!Array.isArray(sessionStarts) || sessionStarts.length !== 1) {
    errors.push('hooks/hooks.json: expected exactly one SessionStart registration');
  } else {
    const matcher = new Set(String(sessionStarts[0].matcher || '').split('|'));
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      if (!matcher.has(source)) errors.push(`hooks/hooks.json: SessionStart matcher misses ${source}`);
    }
    const commands = sessionStarts[0].hooks;
    if (!Array.isArray(commands) || commands.length !== 1) {
      errors.push('hooks/hooks.json: SessionStart must contain exactly one command');
    } else {
      const command = commands[0];
      const allowedHookFields = new Set(['type', 'command', 'args', 'async', 'asyncRewake', 'shell', 'timeout']);
      fields(command, allowedHookFields, 'hooks/hooks.json SessionStart command', errors);
      if (command.type !== 'command') errors.push('hooks/hooks.json: SessionStart hook must be a command');
      if (command.command !== 'node') {
        errors.push('hooks/hooks.json: SessionStart must use the cross-platform Node executable');
      }
      if (
        !Array.isArray(command.args)
        || command.args.length !== 1
        || command.args[0] !== '${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs'
      ) {
        errors.push('hooks/hooks.json: Node hook must resolve session-start.mjs through CLAUDE_PLUGIN_ROOT');
      }
      if (command.shell !== undefined) errors.push('hooks/hooks.json: SessionStart must not force a platform shell');
      if (command.async !== false) errors.push('hooks/hooks.json: bootstrap must run synchronously');
    }
  }

  const agentsDirectory = path.join(root, 'agents');
  let agentFiles = [];
  try {
    agentFiles = (await readdir(agentsDirectory)).filter((file) => file.endsWith('.md')).sort();
  } catch (error) {
    errors.push(`agents: ${error.message}`);
  }
  const agents = {};
  for (const file of agentFiles) {
    const relative = `agents/${file}`;
    const metadata = frontmatter(await readFile(path.join(agentsDirectory, file), 'utf8'), relative, errors);
    fields(metadata, agentFields, relative, errors);
    if (metadata.subagents !== undefined && metadata.subagents !== '[]') {
      errors.push(`${relative}: shared Kimi subagents restriction must be an empty list`);
    }
    for (const ignored of ignoredPluginAgentFields) {
      if (Object.hasOwn(metadata, ignored)) errors.push(`${relative}: ${ignored} is ignored for plugin subagents`);
    }
    agents[file] = metadata;
  }

  const staticReviewer = agents['integration-reviewer.md'] || {};
  const staticTools = csv(staticReviewer.tools);
  const staticDenied = csv(staticReviewer.disallowedTools);
  if (staticTools.size !== 3 || !['Read', 'Grep', 'Glob'].every((tool) => staticTools.has(tool))) {
    errors.push('agents/integration-reviewer.md: tools must be exactly Read, Grep, Glob');
  }
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent']) {
    if (!staticDenied.has(tool)) errors.push(`agents/integration-reviewer.md: must disallow ${tool}`);
  }
  if (staticReviewer.model !== 'inherit' || staticReviewer.effort !== undefined || staticReviewer.maxTurns !== '24') {
    errors.push('agents/integration-reviewer.md: expected portable model inheritance, inherited effort, and maxTurns 24');
  }

  const probe = agents['test-reviewer.md'] || {};
  const probeTools = csv(probe.tools);
  const probeDenied = csv(probe.disallowedTools);
  if (probeTools.size !== 4 || !['Read', 'Grep', 'Glob', 'Bash'].every((tool) => probeTools.has(tool))) {
    errors.push('agents/test-reviewer.md: focused probe must expose only read/search tools plus Bash');
  }
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Agent']) {
    if (!probeDenied.has(tool)) errors.push(`agents/test-reviewer.md: must disallow ${tool}`);
  }
  if (probe.isolation !== 'worktree') errors.push('agents/test-reviewer.md: isolation must be worktree');
  if (probe.model !== 'inherit' || probe.effort !== undefined || probe.maxTurns !== '24') {
    errors.push('agents/test-reviewer.md: expected portable model inheritance, inherited effort, and maxTurns 24');
  }

  for (const required of ['hooks/session-start.mjs', 'skills/using-zimster/SKILL.md']) {
    try {
      if (!(await stat(path.join(root, required))).isFile()) errors.push(`${required}: not a file`);
    } catch {
      errors.push(`${required}: missing`);
    }
  }
  return errors;
}
