import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const states = new Set(['current_truth', 'proposed_delta', 'accepted_decision', 'unresolved_proposal']);
const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];

async function indexPath() {
  if (options.file) return path.resolve(process.cwd(), String(options.file));
  return path.join(await ensureRuntimeDirectory(findRepoRoot(process.cwd())), 'context-index.json');
}

async function load(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value.schema_version !== 1 || !Array.isArray(value.entries)) throw new Error('context index requires schema_version 1 and entries');
  return value;
}

function humanApproval(value) {
  return typeof value === 'string' && /^human:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

const file = await indexPath();
if (action === 'init') {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ schema_version: 1, entries: [] }, null, 2)}\n`, { flag: options.force === true ? 'w' : 'wx' });
  writeLine(file);
} else if (action === 'add') {
  const index = await load(file);
  const id = required(options, 'id');
  const state = required(options, 'state');
  if (!states.has(state)) throw new Error(`unsupported context state: ${state}`);
  if (index.entries.some((entry) => entry.id === id)) throw new Error(`context entry already exists: ${id}`);
  const approvedBy = options['approved-by'] ? String(options['approved-by']) : null;
  if (state === 'accepted_decision' && !humanApproval(approvedBy)) {
    throw new Error('accepted_decision requires --approved-by human:<identity>');
  }
  index.entries.push({
    id,
    state,
    summary: required(options, 'summary'),
    source: required(options, 'source'),
    ...(approvedBy ? { approved_by: approvedBy, approved_at: new Date().toISOString() } : {})
  });
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
  writeLine(JSON.stringify(index.entries.at(-1)));
} else if (action === 'promote') {
  const index = await load(file);
  const id = required(options, 'id');
  const approvedBy = required(options, 'approved-by');
  if (!humanApproval(approvedBy)) throw new Error('promotion requires --approved-by human:<identity>');
  const entry = index.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown context entry: ${id}`);
  if (!['proposed_delta', 'unresolved_proposal'].includes(entry.state)) throw new Error(`context entry ${id} cannot be promoted from ${entry.state}`);
  entry.state = 'accepted_decision';
  entry.approved_by = approvedBy;
  entry.approved_at = new Date().toISOString();
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
  writeLine(JSON.stringify(entry));
} else if (action === 'list') {
  for (const entry of (await load(file)).entries) writeLine(JSON.stringify(entry));
} else {
  throw new Error('Usage: context-index.mjs <init|add|promote|list> [options]');
}
