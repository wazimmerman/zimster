import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { options } = parseOptions(process.argv.slice(2));
const phase = required(options, 'phase');
if (!['slice', 'release'].includes(phase)) throw new Error('--phase must be slice or release');
const root = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(root);
const requirementsPath = options.requirements
  ? path.resolve(process.cwd(), String(options.requirements))
  : path.join(runtime, 'plan', 'requirements.json');
const matrixPath = options.matrix
  ? path.resolve(process.cwd(), String(options.matrix))
  : path.join(runtime, 'plan', 'matrix.json');
const requirements = JSON.parse(await readFile(requirementsPath, 'utf8'));
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
if (requirements.schema_version !== 1 || !Array.isArray(requirements.requirements)) throw new Error('binding requirements require schema_version 1');
if (matrix.schema_version !== 1 || !Array.isArray(matrix.requirements)) throw new Error('requirement matrix requires schema_version 1');

const errors = [];
const currentHead = gitValue(['rev-parse', 'HEAD'], root, null);
const currentTree = gitValue(['rev-parse', 'HEAD^{tree}'], root, null);
if (matrix.candidate_head !== currentHead) errors.push(`matrix candidate_head does not match current HEAD ${currentHead}`);
if (matrix.candidate_tree !== currentTree) errors.push(`matrix candidate_tree does not match current tree ${currentTree}`);
const bindingIds = new Set();
for (const requirement of requirements.requirements) {
  if (bindingIds.has(requirement.id)) errors.push(`duplicate binding requirement ${requirement.id}`);
  bindingIds.add(requirement.id);
  const matches = matrix.requirements.filter((candidate) => candidate.id === requirement.id);
  if (matches.length !== 1) {
    errors.push(`binding requirement ${requirement.id} must appear exactly once in the matrix`);
    continue;
  }
  const row = matches[0];
  if (row.authoritative_text !== requirement.text) errors.push(`requirement ${requirement.id} authoritative text drifted`);
  if (row.source !== requirements.source) errors.push(`requirement ${requirement.id} source drifted`);
  if (!['candidate', matrix.candidate_tree].includes(row.evidence_scope?.git_tree)) {
    errors.push(`requirement ${requirement.id} evidence tree does not bind the candidate tree`);
  }
  if (!Array.isArray(row.implementation_locations) || row.implementation_locations.length === 0) errors.push(`requirement ${requirement.id} has no implementation location`);
  if (!Array.isArray(row.intended_acceptance_claims) || row.intended_acceptance_claims.length === 0) errors.push(`requirement ${requirement.id} has no acceptance claim`);
  if (phase === 'release' && !['verified', 'not_applicable'].includes(row.status)) errors.push(`requirement ${requirement.id} is ${row.status}, not release-conformant`);
  if (phase === 'release' && row.status === 'verified' && (!Array.isArray(row.evidence_refs) || row.evidence_refs.length === 0)) errors.push(`verified requirement ${requirement.id} has no evidence reference`);
}
for (const row of matrix.requirements) {
  if (!bindingIds.has(row.id)) errors.push(`matrix contains non-binding requirement ${row.id}`);
}
if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  writeLine(JSON.stringify({ status: 'PLAN_CONFORMANT', phase, requirements: bindingIds.size }));
}
