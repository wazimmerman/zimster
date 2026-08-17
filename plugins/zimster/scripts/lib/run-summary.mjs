import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureGitState } from './git-state.mjs';
import { readRunState } from './run-state.mjs';

async function readJsonOptional(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonLinesOptional(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function text(value, fallback = 'Unavailable') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function list(values, empty = '- None') {
  if (!Array.isArray(values) || values.length === 0) return empty;
  return values.map((value) => {
    if (typeof value === 'string') return `- ${value}`;
    if (value && typeof value === 'object') {
      const label = value.id || value.title || value.statement || JSON.stringify(value);
      const detail = value.status ? ` — ${value.status}` : '';
      return `- ${label}${detail}`;
    }
    return `- ${String(value)}`;
  }).join('\n');
}

function sliceBlock(slice, none = 'None') {
  if (!slice) return none;
  const rows = [
    `- ID: ${text(slice.id)}`,
    `- Title: ${text(slice.title)}`
  ];
  if (slice.status) rows.push(`- Status: ${slice.status}`);
  if (slice.base_head) rows.push(`- Base HEAD: ${slice.base_head}`);
  if (slice.base_tree) rows.push(`- Base tree: ${slice.base_tree}`);
  return rows.join('\n');
}

function evidenceRows(state, checkpoint) {
  const rows = checkpoint?.evidence_receipts || state.evidence || [];
  if (!rows.length) return '- None recorded';
  return rows.map((row) => {
    if (typeof row === 'string') return `- ${row}`;
    const reason = row.invalidation_reason ? ` — ${row.invalidation_reason}` : '';
    return `- ${text(row.id)} — ${text(row.status, 'recorded')}${reason}`;
  }).join('\n');
}

function budgetRows(budget) {
  if (!budget) return '- Accounting unavailable';
  const keys = new Set([
    ...Object.keys(budget.limits || {}),
    ...Object.keys(budget.usage || {})
  ]);
  const rows = [
    `- Accounting: ${budget.accounting_status || 'recorded'}`,
    ...[...keys].sort().map((metric) =>
    `- ${metric}: ${budget.usage?.[metric] ?? 'unverified'} / ${budget.limits?.[metric] ?? 'unbounded'}`
    ),
    ...(budget.proof_obligations || []).map(({ proof, status }) =>
      `- Proof ${proof}: ${status}`
    )
  ];
  return rows.join('\n');
}

function reviewRows(lifecycle) {
  if (!lifecycle) return '- No review lifecycle initialized';
  return [
    `- Seam: ${text(lifecycle.seam_id)}`,
    `- Status: ${text(lifecycle.status)}`,
    `- Attempts: ${Array.isArray(lifecycle.attempts) ? lifecycle.attempts.length : 0}`,
    `- Circuit breaker: ${lifecycle.circuit_breaker_active === true ? 'active' : 'inactive'}`,
    `- Strategy escalation: ${lifecycle.strategy_escalation?.status || 'inactive'}`
  ].join('\n');
}

function activityRows(rows, describe, empty) {
  if (!rows.length) return `- ${empty}`;
  return rows.map((row) => `- ${row.id || 'unidentified'} — ${describe(row)}`).join('\n');
}

export async function renderRunSummary(runtime, { repo } = {}) {
  const state = await readRunState(runtime);
  if (!state) throw new Error('run.json is required to render run.md');
  const git = await captureGitState(repo || process.cwd());
  const checkpoint = await readJsonOptional(path.join(runtime, 'checkpoints', 'current.json'));
  const budget = await readJsonOptional(path.join(runtime, 'budget.json'));
  const lifecycle = await readJsonOptional(path.join(runtime, 'review-lifecycle', 'whole-release.json'));
  const assurance = await readJsonOptional(path.join(runtime, 'assurance-accounting', 'latest.json'));
  const hostSmoke = await readJsonOptional(path.join(runtime, 'host-smoke', 'latest.json'));
  const dispatches = await readJsonLinesOptional(path.join(runtime, 'dispatches', 'dispatches.jsonl'));
  const delegations = await readJsonLinesOptional(path.join(runtime, 'delegation', 'decisions.jsonl'));
  const convergence = await readJsonLinesOptional(path.join(runtime, 'convergence', 'decisions.jsonl'));
  const capability = state.capability_receipt || { schema_version: 1, harness: null, capabilities: null };
  const completed = state.completed_slices?.length
    ? state.completed_slices
    : state.slice_commits || [];
  const open = [
    ...(state.unresolved_risks || []),
    ...(checkpoint?.open_findings || [])
  ];
  const unavailable = checkpoint?.unavailable_evidence || [];
  const guards = checkpoint?.guards || checkpoint?.guard_assertions || state.guard_assertions || [];

  return `# Zimster Run

> Generated deterministically from canonical Git-local machine state. Do not edit this derived view.

## Mission and plan

- Run: ${state.id}
- Plan: ${text(state.plan?.id)}
- Plan source: ${text(state.plan?.source)}

## Profile and rationale

- Profile: ${text(state.profile)}
- Rationale: ${text(state.profile_rationale)}

## Harness capability receipt

\`\`\`json
${JSON.stringify(capability, null, 2)}
\`\`\`

## Git disposition

- Branch: ${text(git.branch, 'DETACHED')}
- Starting HEAD: ${text(state.starting_head)}
- Current HEAD: ${text(git.head)}
- Current tree: ${text(git.tree)}
- Dirty-tree fingerprint: ${git.dirty_tree_fingerprint}

## Architecture

${list(state.architecture, '- Ownership metadata unavailable')}

## Current slice

${sliceBlock(state.current_slice)}

## Next slice

${sliceBlock(state.next_slice)}

## Exact next action

- Action: ${text(checkpoint?.exact_next_action || state.exact_next_action)}
- Command: ${text(checkpoint?.exact_next_command || state.exact_next_command)}

## Recovery snapshot

- Status: ${text(checkpoint?.recovery_status, 'No checkpoint')}
- Run revision: ${checkpoint?.run_state_revision ?? state.state_revision ?? 'unavailable'}
- Touched files:
${list(checkpoint?.repository_state?.touched_files || [])}
- Active failure: ${text(checkpoint?.active_failure?.summary, 'None')}
- Reconciliation: ${text(checkpoint?.reconciliation_reason, 'None')}
- Active transaction: ${text(checkpoint?.active_transaction?.transaction_id, 'None')}

## Completed slices and commits

${list(completed)}

## Evidence validity

${evidenceRows(state, checkpoint)}
- Host smoke: ${hostSmoke ? `${text(hostSmoke.status)} at ${text(hostSmoke.candidate_head)}` : 'Unavailable'}

## Review and convergence

${reviewRows(lifecycle)}
- Assurance accounting: ${assurance ? (assurance.reconciliation_complete ? 'current' : 'unreconciled') : 'unavailable'}
- Convergence decisions:
${activityRows(convergence, (row) => row.outcome || row.decision?.outcome || 'recorded', 'None recorded')}

## Budget position

${budgetRows(budget)}

## Open findings and risks

${list(open)}

## Unavailable proof

${list(unavailable)}

## Side-effect and guard state

${list(guards)}

## Dispatch and delegation

- Delegation decisions:
${activityRows(delegations, (row) => row.selected ? `selected ${row.role || 'role unavailable'}` : 'inline', 'None recorded')}
- Dispatches:
${activityRows(dispatches, (row) => `${row.role || 'role unavailable'} / ${row.effective_model || 'unverified'}`, 'None recorded')}
`;
}

export async function refreshRunSummary(runtime, options = {}) {
  const file = path.join(runtime, 'run.md');
  const temporary = `${file}.temporary-${process.pid}-${Date.now()}`;
  const rendered = await renderRunSummary(runtime, options);
  try {
    await writeFile(temporary, rendered, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return rendered;
}

export async function checkRunSummary(runtime, options = {}) {
  const expected = await renderRunSummary(runtime, options);
  let actual = null;
  try {
    actual = await readFile(path.join(runtime, 'run.md'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { current: actual === expected, expected, actual };
}
