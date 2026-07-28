import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, required, writeLine } from './lib/cli.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];

function enabled(name) {
  const value = options[name];
  return value === true || ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function validRecord(harness, record) {
  if (!record || !Number.isInteger(record.max_age_days) || record.max_age_days <= 0) {
    throw new Error(`${harness} capability cache requires a positive max_age_days`);
  }
  const checked = Date.parse(record.checked_at);
  if (!Number.isFinite(checked)) {
    throw new Error(`${harness} capability cache requires checked_at`);
  }
  if (
    !Array.isArray(record.sources)
    || !record.sources.length
    || !record.sources.every((source) =>
      source
      && typeof source.title === 'string'
      && /^https:\/\/[^/]+/.test(String(source.url || ''))
    )
  ) {
    throw new Error(`${harness} capability cache requires source-linked records`);
  }
  return checked;
}

if (action !== 'status') {
  throw new Error('Usage: capability-cache.mjs status --harness <id> [options]');
}

const config = path.resolve(
  process.cwd(),
  String(options.config || path.join(packageRoot, 'config', 'harness-capabilities.json'))
);
const matrix = JSON.parse(await readFile(config, 'utf8'));
if (matrix.schema_version !== 2 || !matrix.harnesses) {
  throw new Error('capability cache requires schema_version 2 and harnesses');
}
const harness = required(options, 'harness').toLowerCase();
const record = matrix.harnesses[harness];
if (!record) throw new Error(`unknown harness: ${harness}`);
const checked = validRecord(harness, record);
const now = options.now ? Date.parse(String(options.now)) : Date.now();
if (!Number.isFinite(now)) throw new Error('--now must be an ISO-8601 timestamp');
const expires = checked + record.max_age_days * 24 * 60 * 60 * 1000;
const reasons = [];
if (now > expires) reasons.push('configured_age_expired');
if (
  options['host-version'] !== undefined
  && String(options['host-version']) !== String(record.local_host_version)
) {
  reasons.push('local_host_version_changed');
}
if (String(options['validator-status'] || record.validator_status) === 'contradicted') {
  reasons.push('official_validator_contradiction');
}
if (enabled('task-changes-integration')) reasons.push('current_task_changes_host_integration');
if (enabled('fresh-research')) reasons.push('user_requested_fresh_research');

writeLine(JSON.stringify({
  schema_version: 1,
  harness,
  refresh_required: reasons.length > 0,
  reasons,
  checked_at: new Date(checked).toISOString(),
  expires_at: new Date(expires).toISOString(),
  sources: record.sources.map(({ url }) => url)
}));
if (reasons.length) process.exitCode = 2;
