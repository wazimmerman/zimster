import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { captureGitState, changedFiles } from './git-state.mjs';
import { CONVERGENCE_METRICS } from './convergence.mjs';
import { writeAtomically } from './run-state.mjs';

async function optionalText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJson(file) {
  const text = await optionalText(file);
  return text === null ? null : JSON.parse(text);
}

async function jsonlCount(file, predicate = () => true) {
  const text = await optionalText(file);
  if (text === null) return 0;
  return text.split('\n').filter(Boolean).map(JSON.parse).filter(predicate).length;
}

function rendered(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function migrate070State({ root, runtime }) {
  const runFile = path.join(runtime, 'run.json');
  const original = await optionalJson(runFile);
  if (!original) throw new Error('0.7.0 migration requires an existing run.json');
  if (original.schema_version !== 2) {
    throw new Error(`unsupported run.json schema_version ${original.schema_version}`);
  }
  if (original.migration?.source_version === '0.7.0') {
    const reportFile = path.join(runtime, 'migration-0.7.0.json');
    const report = await optionalJson(reportFile);
    if (!report) throw new Error('already-migrated 0.7.0 state is missing its migration report');
    return { report, reportFile, migrationStatus: 'already_migrated' };
  }
  const currentFields = [
    'profile', 'rationale', 'capability_receipt', 'branch', 'commit_policy',
    'durable_state_triggers', 'current_slice', 'next_slice', 'recovery'
  ];
  const currentFieldCount = currentFields.filter((field) => Object.hasOwn(original, field)).length;
  if (currentFieldCount === currentFields.length) {
    return { report: null, reportFile: null, migrationStatus: 'already_current' };
  }
  const legacyFields = [
    'id', 'root_actor_id', 'started_at', 'starting_head', 'plan', 'decisions',
    'slice_commits', 'evidence', 'verifications', 'unresolved_risks'
  ];
  if (!legacyFields.every((field) => Object.hasOwn(original, field)) || currentFieldCount !== 0) {
    throw new Error('run.json cannot be safely identified as genuine 0.7.0 state');
  }
  const checkpoint = await optionalJson(path.join(runtime, 'checkpoints', 'current.json'));
  const budget = await optionalJson(path.join(runtime, 'budget.json'));
  const git = await captureGitState(root);
  const files = changedFiles(root);
  const state = structuredClone(original);

  state.state_format_revision ??= 2;
  state.profile ??= budget?.profile || 'unknown';
  state.rationale ??= 'Preserved from a 0.7.0 run; richer rationale was unavailable.';
  state.mission ??= checkpoint?.mission_digest || null;
  state.capability_receipt ??= null;
  state.branch ??= git.branch || null;
  state.commit_policy ??= 'unknown';
  state.durable_state_triggers ??= [];
  if (!Object.hasOwn(state, 'current_slice')) {
    if (checkpoint) {
      state.current_slice = null;
      state.current_slice_status = 'unknown';
      state.next_slice = {
        id: 'legacy-next',
        summary: checkpoint.exact_next_slice
      };
      state.recovery = {
        dirty_tree_fingerprint: git.dirty_tree_fingerprint,
        touched_files: files,
        latest_failure: null,
        latest_test: null,
        next_action: checkpoint.exact_next_slice,
        next_command: null
      };
    } else {
      state.current_slice = null;
      state.current_slice_status = 'unknown';
      state.next_slice = null;
      state.recovery = null;
    }
  } else {
    state.current_slice_status ??= state.current_slice?.status || 'unknown';
    state.next_slice ??= null;
    state.recovery ??= null;
  }
  state.migration ??= {
    source_version: '0.7.0',
    bounded: true,
    historical_records_rewritten: false
  };

  const evidenceFile = path.join(runtime, 'evidence', 'receipts.jsonl');
  const preservedRecords = {
    delegation_decisions: await jsonlCount(path.join(runtime, 'delegation', 'decisions.jsonl')),
    dispatches: await jsonlCount(path.join(runtime, 'dispatches', 'dispatches.jsonl')),
    evidence_receipts: await jsonlCount(evidenceFile, (row) => row.record_type !== 'invalidation'),
    review_history: await jsonlCount(path.join(runtime, 'reviews', 'history.jsonl'))
  };
  const knownBudgetUsage = structuredClone(budget?.usage || {});
  const report = {
    schema_version: 1,
    migration: '0.7.0-to-0.7.2',
    run_id: state.id,
    status: 'compatible',
    bounded: true,
    preserved_records: preservedRecords,
    known_budget_usage: knownBudgetUsage,
    unknown_budget_metrics: CONVERGENCE_METRICS.filter(
      (metric) => !Object.hasOwn(knownBudgetUsage, metric)
    ),
    approval_state: 'unavailable',
    current_slice_state: state.current_slice_status,
    dirty_in_progress: git.dirty_tree_fingerprint
      !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    unknown_facts: [
      ...(state.current_slice_status === 'unknown' ? ['current_slice'] : []),
      ...(state.recovery?.latest_failure === null ? ['latest_failure'] : []),
      ...(state.recovery?.latest_test === null ? ['latest_test'] : []),
      ...(state.recovery?.next_command === null ? ['next_command'] : []),
      ...(!checkpoint ? ['checkpoint'] : [])
    ].sort(),
    source_records_preserved: true
  };
  const reportFile = path.join(runtime, 'migration-0.7.0.json');
  const reportBytes = rendered(report);
  // Persist the derived report first. If interrupted here, canonical run.json
  // remains recognizably legacy and a restart deterministically retries. Once
  // run.json advances, the complete report is already durable.
  if (reportBytes !== await optionalText(reportFile)) await writeAtomically(reportFile, reportBytes);
  const stateBytes = rendered(state);
  if (stateBytes !== await optionalText(runFile)) await writeAtomically(runFile, stateBytes);
  return { report, reportFile, migrationStatus: 'migrated' };
}
