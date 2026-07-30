import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { evaluateRequirementMatrix } from './lib/semantic-assurance.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

async function jsonFile(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  return JSON.parse(await readFile(file, 'utf8'));
}

async function evidenceRecords() {
  const runtime = options.evidence
    ? null
    : await ensureRuntimeDirectory(root);
  const file = options.evidence
    ? path.resolve(process.cwd(), String(options.evidence))
    : path.join(runtime, 'evidence', 'receipts.jsonl');
  let rows;
  try {
    rows = (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const invalidated = new Set(
    rows
      .filter((row) => row.record_type === 'invalidation')
      .map((row) => row.receipt_id)
  );
  return rows
    .filter((row) => row.record_type !== 'invalidation')
    .map((row) => ({
      ...row,
      status: invalidated.has(row.id)
        ? 'stale'
        : row.exit_code === 0 ? 'valid' : 'failed'
    }));
}

async function matrixDecision() {
  const requirements = await jsonFile('requirements');
  const matrix = await jsonFile('matrix');
  const result = evaluateRequirementMatrix({
    bindingRequirements: requirements.requirements,
    matrix,
    evidence: await evidenceRecords()
  });
  writeLine(JSON.stringify(result));
  const counts = Object.entries(result.counts)
    .map(([state, count]) => `${state}=${count}`)
    .join(' ');
  writeError(`${result.valid ? 'MATRIX_VALID' : 'MATRIX_INCOMPLETE'} ${counts}`);
  for (const issue of result.issues) writeError(`- ${issue}`);
  if (!result.valid) process.exitCode = 2;
}

if (action === 'matrix') {
  await matrixDecision();
} else {
  throw new Error('Usage: semantic-assurance.mjs matrix --requirements <file> --matrix <file> [--evidence <jsonl>]');
}
