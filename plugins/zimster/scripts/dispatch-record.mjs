import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseOptions, required, integerOption } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory, migrateLegacyJsonlStore } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
let directory;
let file;
const tiers = new Set(['fast', 'standard', 'expert']);

async function init() {
  const runtime = await ensureRuntimeDirectory(root);
  await migrateLegacyJsonlStore(root, runtime, 'dispatches', 'dispatches.jsonl');
  directory ||= path.join(runtime, 'dispatches');
  file ||= path.join(directory, 'dispatches.jsonl');
  await mkdir(directory, { recursive: true });
  try { await writeFile(path.join(directory, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  try { await readFile(file, 'utf8'); } catch { await writeFile(file, ''); }
}

async function rows() {
  await init();
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function replaceRows(records) {
  await writeFile(file, records.map((row) => JSON.stringify(row)).join('\n') + (records.length ? '\n' : ''));
}

function addInheritanceWarning(row) {
  delete row.warning;
  if (row.tier === 'fast' && row.parent_model && row.effective_model !== 'unverified' && row.effective_model === row.parent_model) {
    row.warning = 'Fast-tier task inherited the parent model; verify that this was intentional.';
  }
  return row;
}

async function main() {
  if (action === 'init') {
    await init();
    console.log(directory);
    return;
  }
  if (action === 'list') {
    await init();
    process.stdout.write(await readFile(file, 'utf8'));
    return;
  }
  if (action === 'update') {
    const id = required(options, 'id');
    const records = await rows();
    const row = records.find((item) => item.id === id);
    if (!row) throw new Error(`dispatch record not found: ${id}`);
    if (options['effective-model']) row.effective_model = String(options['effective-model']);
    if (options['effective-effort']) row.effective_effort = String(options['effective-effort']);
    if (options['agent-id']) row.agent_id = String(options['agent-id']);
    row.completed_at = new Date().toISOString();
    addInheritanceWarning(row);
    await replaceRows(records);
    console.log(JSON.stringify(row));
    return;
  }
  if (action !== 'record') throw new Error('Usage: dispatch-record.mjs <init|record|update|list>');

  const tier = required(options, 'tier');
  if (!tiers.has(tier)) throw new Error('--tier must be fast, standard, or expert');
  const row = addInheritanceWarning({
    schema_version: 1,
    id: randomUUID(),
    role: required(options, 'role'),
    purpose: required(options, 'purpose'),
    tier,
    requested_model: String(options['requested-model'] || 'harness-default'),
    requested_effort: String(options['requested-effort'] || 'harness-default'),
    effective_model: String(options['effective-model'] || 'unverified'),
    effective_effort: String(options['effective-effort'] || 'unverified'),
    parent_model: options['parent-model'] ? String(options['parent-model']) : null,
    agent_id: options['agent-id'] ? String(options['agent-id']) : null,
    turn_limit: integerOption(options, 'turn-limit', 12),
    commit_permission: String(options['commit-permission'] || 'none'),
    ownership: options.ownership ? String(options.ownership) : null,
    output_path: options.output ? String(options.output) : null,
    created_at: new Date().toISOString()
  });
  await init();
  await appendFile(file, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
