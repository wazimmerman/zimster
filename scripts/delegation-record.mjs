import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { validateDelegationDecision } from './lib/model-routing.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

function listOption(name) {
  return required(options, name).split(',').map((value) => value.trim()).filter(Boolean);
}

function booleanOption(name) {
  const value = required(options, name).toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`--${name} must be true or false`);
  return value === 'true';
}

async function store() {
  const runtime = await ensureRuntimeDirectory(root);
  const directory = path.join(runtime, 'delegation');
  const file = path.join(directory, 'decisions.jsonl');
  await mkdir(directory, { recursive: true });
  try { await writeFile(path.join(directory, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return { runtime, file };
}

async function runId(runtime) {
  try {
    const run = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
    return run.id;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return `standalone-${gitValue(['rev-parse', '--short=12', 'HEAD'], root, 'unborn')}`;
  }
}

async function main() {
  const { runtime, file } = await store();
  if (action === 'list') {
    try { process.stdout.write(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  if (action !== 'decide') throw new Error('Usage: delegation-record.mjs <decide|list>');
  const selected = booleanOption('selected');
  const decision = {
    schema_version: 1,
    id: randomUUID(),
    run_id: await runId(runtime),
    selected,
    reason: required(options, 'reason'),
    inline_assessment: required(options, 'inline-assessment'),
    created_at: new Date().toISOString()
  };
  if (selected) Object.assign(decision, {
    role: required(options, 'role'),
    ownership: listOption('ownership'),
    tool_restrictions: listOption('tool-restrictions'),
    dependency_cone: listOption('dependency-cone'),
    stop_condition: required(options, 'stop-condition'),
    acceptance_proof: required(options, 'acceptance-proof')
  });
  validateDelegationDecision(decision);
  await appendFile(file, `${JSON.stringify(decision)}\n`);
  writeLine(JSON.stringify(decision));
}

main().catch((error) => {
  writeError(error.message);
  process.exitCode = 1;
});
