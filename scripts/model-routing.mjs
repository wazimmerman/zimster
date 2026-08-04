import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { digestJson } from './lib/config-layers.mjs';
import {
  createModelProposal,
  proposalInputs,
  resolveProposal,
  validateRoutingConfig
} from './lib/model-routing.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

async function parseJsonFile(filePath) {
  return JSON.parse(await readFile(path.resolve(root, filePath), 'utf8'));
}

function jsonOption(name, fallback = {}) {
  if (options[name] === undefined) return fallback;
  try { return JSON.parse(String(options[name])); } catch { throw new Error(`--${name} must be valid JSON`); }
}

async function storage() {
  const runtime = await ensureRuntimeDirectory(root);
  const directory = path.join(runtime, 'routing');
  await mkdir(directory, { recursive: true });
  try { await writeFile(path.join(directory, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return {
    runtime,
    proposals: path.join(directory, 'proposals.jsonl'),
    resolutions: path.join(directory, 'resolutions.jsonl'),
    observations: path.join(directory, 'observations.jsonl')
  };
}

async function jsonl(file) {
  try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function writeJsonl(file, rows) {
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function decisionById(runtime, id) {
  const rows = await jsonl(path.join(runtime, 'delegation', 'decisions.jsonl'));
  const decision = rows.find((row) => row.id === id);
  if (!decision) throw new Error(`delegation decision not found: ${id}`);
  return decision;
}

async function main() {
  if (action === 'validate-config') {
    const config = validateRoutingConfig(await parseJsonFile(required(options, 'config')));
    writeLine(JSON.stringify({ valid: true, digest: digestJson(config) }));
    return;
  }
  const files = await storage();
  if (action === 'list') {
    for (const row of await jsonl(files.proposals)) writeLine(JSON.stringify(row));
    return;
  }
  if (action === 'resolve') {
    const proposalId = required(options, 'proposal-id');
    const proposals = await jsonl(files.proposals);
    const proposal = [...proposals].reverse().find((row) => row.id === proposalId);
    if (!proposal) throw new Error(`model proposal not found: ${proposalId}`);
    const git = await captureGitState(root);
    const resolution = resolveProposal(proposal, {
      ...proposalInputs(proposal),
      gitFingerprint: git.working_tree_hash
    });
    await appendFile(files.resolutions, `${JSON.stringify(resolution)}\n`);
    writeLine(JSON.stringify(resolution));
    return;
  }
  if (action !== 'propose') {
    throw new Error('Usage: model-routing.mjs <validate-config|propose|resolve|observe|summarize|list>');
  }
  const delegation = await decisionById(files.runtime, required(options, 'delegation-id'));
  const config = options.config ? validateRoutingConfig(await parseJsonFile(String(options.config))) : { routing: {} };
  const routing = config.routing || config;
  const git = await captureGitState(root);
  const proposal = createModelProposal({
    delegation,
    phase: required(options, 'phase'),
    capabilityClass: required(options, 'capability-class'),
    reasoningEffort: required(options, 'reasoning-effort'),
    taskSignature: jsonOption('task-signature'),
    mode: String(options.mode || routing.mode || 'inherit'),
    policy: String(options.policy || routing.policy || 'balanced'),
    gitFingerprint: git.working_tree_hash,
    configDigest: digestJson(config),
    mappingDigest: digestJson(routing.mappings || {}),
    harness: String(options.harness || 'unverified'),
    harnessVersion: String(options['harness-version'] || 'unverified'),
    capabilityDigest: String(options['capability-digest'] || 'unverified'),
    catalogDigest: String(options['catalog-digest'] || 'unverified'),
    supersedes: options.supersedes ? String(options.supersedes) : null
  });
  if (proposal.supersedes) {
    const proposals = await jsonl(files.proposals);
    const previous = proposals.find((row) => row.id === proposal.supersedes);
    if (!previous) throw new Error(`superseded proposal not found: ${proposal.supersedes}`);
    if (previous.status !== 'active') throw new Error(`superseded proposal must be active; status is ${previous.status}`);
    if (previous.delegation_id !== proposal.delegation_id) throw new Error('superseded proposal belongs to a different delegation decision');
    previous.status = 'invalidated';
    previous.superseded_by = proposal.id;
    await writeJsonl(files.proposals, [...proposals, proposal]);
  } else {
    await appendFile(files.proposals, `${JSON.stringify(proposal)}\n`);
  }
  writeLine(JSON.stringify(proposal));
}

main().catch((error) => {
  writeError(error.message);
  process.exitCode = 1;
});
