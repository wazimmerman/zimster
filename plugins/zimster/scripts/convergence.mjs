import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  convergenceRecord,
  decideConvergence,
  normalizeConvergenceMetric,
  validateConvergenceConfig
} from './lib/convergence.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const root = findRepoRoot(process.cwd());

function requiredBoolean(name) {
  const value = required(options, name);
  if (!['true', 'false'].includes(String(value))) throw new Error(`--${name} must be true or false`);
  return String(value) === 'true';
}

async function main() {
  if (positional[0] !== 'decide') {
    throw new Error('Usage: convergence.mjs decide --event <kind> --scope <in-scope|out-of-scope> --sensitivity <ordinary|sensitive> --reversible <true|false> --authorized <true|false> --deterministic <true|false> --locality <local|external> --metric <name>');
  }
  const runtime = await ensureRuntimeDirectory(root);
  const configPath = options.config
    ? path.resolve(root, String(options.config))
    : fileURLToPath(new URL('../config/convergence.json', import.meta.url));
  const config = validateConvergenceConfig(JSON.parse(await readFile(configPath, 'utf8')));
  const budget = JSON.parse(await readFile(path.join(runtime, 'budget.json'), 'utf8'));
  const requestedMetric = required(options, 'metric');
  if (['correction_rechecks', 'review_rechecks_per_seam', 'final_integration_reviews', 'final_correction_waves'].includes(requestedMetric)) {
    throw new Error('canonical review lifecycle is authoritative for review cardinality; use review-control.mjs');
  }
  const metric = normalizeConvergenceMetric(requestedMetric);
  const scope = required(options, 'scope');
  const sensitivity = required(options, 'sensitivity');
  const reversible = requiredBoolean('reversible');
  const authorized = requiredBoolean('authorized');
  const deterministic = requiredBoolean('deterministic');
  const locality = required(options, 'locality');
  const condition = options.condition ? String(options.condition) : null;
  const enabled = config.autonomous_convergence.enabled;
  const used = Number(budget.usage?.[metric] || 0);
  const limit = Number(budget.limits?.[metric]);
  const decision = decideConvergence({
    event: required(options, 'event'), scope, sensitivity,
    reversible,
    authorized,
    deterministic,
    locality,
    condition,
    metric, used, limit,
    enabled
  });
  const runState = JSON.parse(await readFile(path.join(runtime, 'run.json'), 'utf8'));
  const record = convergenceRecord({
    runId: runState.id,
    event: required(options, 'event'),
    scope,
    sensitivity,
    reversible,
    authorized,
    deterministic,
    locality,
    condition,
    enabled,
    decision
  });
  const directory = path.join(runtime, 'convergence');
  await mkdir(directory, { recursive: true });
  await appendFile(path.join(directory, 'decisions.jsonl'), `${JSON.stringify(record)}\n`);
  writeLine(JSON.stringify(record));
}

main().catch((error) => {
  writeError(error.message);
  process.exitCode = 1;
});
