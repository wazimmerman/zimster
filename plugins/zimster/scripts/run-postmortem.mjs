import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { readRunState } from './lib/run-state.mjs';

const { options } = parseOptions(process.argv.slice(2));
const runtime = options.runtime
  ? path.resolve(process.cwd(), String(options.runtime))
  : await ensureRuntimeDirectory(findRepoRoot(process.cwd()));
if (options.now && !Number.isFinite(new Date(String(options.now)).getTime())) {
  throw new Error('--now must be an ISO-8601 timestamp');
}

async function optionalJson(relative) {
  try {
    return JSON.parse(await readFile(path.join(runtime, relative), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJsonl(relative) {
  try {
    const text = await readFile(path.join(runtime, relative), 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function verificationReceipts() {
  const directory = path.join(runtime, 'verification', 'receipts');
  try {
    const rows = [];
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.json')).sort()) {
      rows.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
    }
    return rows;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function observed(value, extra = {}) {
  return { observation: 'observed', ...extra, ...value };
}

function unavailable(reason) {
  return { observation: 'unavailable', reason };
}

function countEvents(events, eventType) {
  return (events || []).filter(({ event_type: type }) => type === eventType);
}

const budget = await optionalJson('budget.json');
const hostVerification = await optionalJson('host-smoke/latest.json');
const runState = await readRunState(runtime);
const startedAt = runState ? Date.parse(runState.started_at) : null;
function currentRunRow(row, timestampFields) {
  if (!runState) return true;
  if (row.run_id) return row.run_id === runState.id;
  for (const field of timestampFields) {
    const timestamp = Date.parse(row[field]);
    if (Number.isFinite(timestamp)) return timestamp >= startedAt;
  }
  return false;
}
const allDispatches = await optionalJsonl('dispatches/dispatches.jsonl');
const dispatches = allDispatches?.filter((row) =>
  currentRunRow(row, ['created_at', 'completed_at'])
) ?? null;
const allDelegationDecisions = await optionalJsonl('delegation/decisions.jsonl');
const delegationDecisions = allDelegationDecisions?.filter((row) =>
  currentRunRow(row, ['created_at'])
) ?? null;
const allProposals = await optionalJsonl('routing/proposals.jsonl');
const proposals = allProposals?.filter((row) => currentRunRow(row, ['created_at'])) ?? null;
const allResolutions = await optionalJsonl('routing/resolutions.jsonl');
const resolutions = allResolutions?.filter((row) => currentRunRow(row, ['created_at'])) ?? null;
const allConvergenceDecisions = await optionalJsonl('convergence/decisions.jsonl');
const convergenceDecisions = allConvergenceDecisions?.filter((row) => currentRunRow(row, ['created_at'])) ?? null;
const allLedger = await optionalJsonl('evidence/receipts.jsonl');
const ledger = allLedger?.filter((row) =>
  currentRunRow(row, ['ended_at', 'started_at', 'recorded_at'])
) ?? null;
const allEvents = await optionalJsonl('events/events.jsonl');
const events = allEvents?.filter((row) => currentRunRow(row, ['recorded_at'])) ?? null;
const allVerification = await verificationReceipts();
const verification = allVerification?.filter((row) =>
  row.governed_execution === true
  && currentRunRow(row, ['started_at', 'ended_at'])
) ?? null;
const evidence = (ledger || []).filter((row) =>
  row.record_type !== 'invalidation' && row.governed_execution === true
);
const unavailableMetrics = [];
const metric = (name, value) => {
  if (value.observation === 'unavailable') unavailableMetrics.push(name);
  return value;
};

const roots = [...new Set(
  [
    runState?.root_actor_id,
    ...countEvents(events, 'run_started').map(({ actor_id: id }) => id)
  ].filter(Boolean)
)].sort();
const subagents = [...new Set((dispatches || []).map(({ agent_id: id }) => id).filter(Boolean))].sort();
const identitiesAvailable = runState !== null || events !== null || dispatches !== null;
const identities = identitiesAvailable
  ? observed({ root: roots, subagents })
  : unavailable('run events and dispatch records are absent');

const starts = countEvents(events, 'run_started');
const resumes = countEvents(events, 'run_resumed');
const startsAndResumes = events === null
  ? unavailable('run lifecycle events are absent')
  : observed({ starts: starts.length, resumes: resumes.length });

const modelsAndEffort = dispatches === null
  ? unavailable('dispatch records are absent')
  : observed({
    agents: dispatches.map((row) => ({
      id: row.agent_id || row.id,
      model: row.effective_model || 'unverified',
      effort: row.effective_effort || 'unverified'
    }))
  });

const delegationMetric = delegationDecisions === null
  ? unavailable('delegation decisions are absent')
  : observed({
    total: delegationDecisions.length,
    selected: delegationDecisions.filter(({ selected }) => selected === true).length,
    inline: delegationDecisions.filter(({ selected }) => selected === false).length
  });

const routingMetric = proposals === null && resolutions === null && dispatches === null
  ? unavailable('routing proposals, resolutions, and dispatches are absent')
  : observed({
    proposals: proposals?.length || 0,
    advisory_proposals: (proposals || []).filter(({ authority }) => authority === 'advisory').length,
    authoritative_proposals: (proposals || []).filter(({ authority }) => authority === 'authoritative').length,
    cancelled_dispatches: (resolutions || []).filter(({ action }) => action === 'cancel').length,
    blocked_dispatches: (resolutions || []).filter(({ action }) => action === 'blocked').length,
    owner_accepted: (dispatches || []).filter((row) => row.owner_acceptance?.status === 'accepted').length,
    owner_rejected: (dispatches || []).filter((row) => row.owner_acceptance?.status === 'rejected').length,
    effective_mismatches: (dispatches || []).filter((row) =>
      row.requested_model
      && !['inherit', 'none', 'unverified'].includes(row.requested_model)
      && row.effective_model
      && row.effective_model !== 'unverified'
      && row.effective_model !== row.requested_model
    ).length,
    fallbacks: [...new Set((resolutions || []).flatMap(({ fallback_trace: trace }) => trace || []))].sort()
  });
const supportMatrixMetric = hostVerification === null
  ? unavailable('claim-scoped host verification receipt is absent')
  : observed({
    release_channel: hostVerification.release_channel,
    status: hostVerification.status,
    live_verified_host_ids: hostVerification.live_verified_host_ids || [],
    all_claims_bounded: hostVerification.all_claims_bounded === true,
    harnesses: Object.fromEntries((hostVerification.hosts || []).map((host) => [
      host.id,
      {
        verification_level: host.verification_state,
        tested: host.commands_or_observations,
        not_tested: host.capabilities_not_established,
        installation_available: host.installation_available,
        known_limitations: host.known_limitations,
        public_claims: host.public_claims,
        model_backed_execution: host.model_backed_execution,
        expires_at: host.expires_at
      }
    ]))
  });

const tokenEvents = countEvents(events, 'token_meter');
let tokens;
if (events === null || tokenEvents.length === 0) {
  tokens = unavailable('compatible token-meter observations are absent');
} else {
  const groups = new Map();
  for (const event of tokenEvents) {
    if (!Number.isFinite(event.tokens) || !event.meter || !event.compatibility_group) continue;
    const key = `${event.compatibility_group}\0${event.meter}`;
    const row = groups.get(key) || {
      meter: event.meter,
      compatibility_group: event.compatibility_group,
      tokens: 0
    };
    row.tokens += event.tokens;
    groups.set(key, row);
  }
  tokens = groups.size
    ? observed({ meters: [...groups.values()].sort((a, b) => a.meter.localeCompare(b.meter)) })
    : unavailable('token events omitted meter compatibility metadata');
}

let commands;
if (ledger === null) {
  commands = unavailable('evidence ledger is absent');
} else {
  const groups = new Map();
  let executions = 0;
  for (const row of evidence) {
    executions += 1;
    const identity = row.command_identity || row.command;
    if (!identity) continue;
    groups.set(identity, (groups.get(identity) || 0) + 1);
  }
  for (const receipt of verification || []) {
    for (const step of receipt.steps || []) {
      if (step.status === 'not_run' || step.governed_execution !== true) continue;
      executions += 1;
      const identity = step.command_identity;
      if (identity) groups.set(identity, (groups.get(identity) || 0) + 1);
    }
  }
  commands = {
    observation: 'partial',
    coverage: ['evidence_receipts', 'verification_steps'],
    unavailable: ['commands executed outside recorded wrappers'],
    executions,
    unique_commands: groups.size,
    exact_duplicate_executions: [...groups.values()]
      .reduce((total, count) => total + Math.max(0, count - 1), 0),
    exact_duplicate_groups: [...groups.values()].filter((count) => count > 1).length
  };
}

let testsByClass;
if (ledger === null) {
  testsByClass = unavailable('test evidence ledger is absent');
} else {
  const classes = {};
  for (const row of evidence) {
    if (row.tests?.discovery !== 'tests_executed') continue;
    const name = row.kind || 'unknown';
    const current = classes[name] || { receipts: 0, passed: 0, failed: 0, skipped: 0 };
    current.receipts += 1;
    current.passed += row.tests.passed || 0;
    current.failed += row.tests.failed || 0;
    current.skipped += row.tests.skipped || 0;
    classes[name] = current;
  }
  testsByClass = observed(classes);
}

const usageMetric = (name, unavailableReason) => budget
  ? observed({ value: budget.usage?.[name] ?? 0 })
  : unavailable(unavailableReason);
const aliasedUsageMetric = (name, alias, unavailableReason) => budget
  ? observed({ value: budget.usage?.[name] ?? budget.usage?.[alias] ?? 0 })
  : unavailable(unavailableReason);
const researchEvents = countEvents(events, 'research');
const research = events !== null && researchEvents.length
  ? observed({ value: researchEvents.length })
  : unavailable('research events were not recorded');
const phaseEvents = countEvents(events, 'phase_duration');
const timeByPhase = events === null || !phaseEvents.length
  ? unavailable('phase duration events are absent')
  : observed({
    phases: Object.fromEntries(
      [...new Set(phaseEvents.map(({ phase }) => phase))].sort().map((phase) => [
        phase,
        phaseEvents.filter((row) => row.phase === phase)
          .reduce((total, row) => total + (Number(row.duration_ms) || 0), 0)
      ])
    )
  });

let budgetCompliance;
if (!budget) {
  budgetCompliance = unavailable('execution budget is absent');
} else {
  const exceededRows = Object.entries(budget.usage || {})
    .filter(([name, value]) =>
      name !== 'correction_rechecks'
      && !['final_correction_waves', 'review_rechecks_per_seam', 'context_compactions'].includes(name)
      && Number.isFinite(budget.limits?.[name])
      && value > budget.limits[name]
    )
    .map(([metric]) => ({ metric, scope: null, label: metric }));
  for (const [scope, value] of Object.entries(
    budget.scoped_usage?.correction_rechecks || budget.scoped_usage?.review_rechecks_per_seam || {}
  )) {
    const correctionRecheckLimit = budget.limits.correction_rechecks
      ?? budget.limits.review_rechecks_per_seam;
    if (value > correctionRecheckLimit) {
      exceededRows.push({
        metric: 'correction_rechecks',
        scope,
        label: `correction_rechecks:${scope}`
      });
    }
  }
  const exceeded = exceededRows.map(({ label }) => label);
  const overrides = budget.overrides || [];
  const pendingProofs = (budget.proof_obligations || []).filter(({ status }) => status === 'required');
  const unjustified = [
    ...exceededRows.filter(({ metric, scope }) =>
      !overrides.some((override) =>
        override.metric === metric && (override.scope || null) === scope
      )
    ).map(({ label }) => label),
    ...pendingProofs.map(({ metric: name }) => name)
  ];
  budgetCompliance = observed({
    status: unjustified.length ? 'noncompliant' : exceeded.length ? 'compliant_with_overrides' : 'within_budget',
    exceeded,
    unjustified: [...new Set(unjustified)],
    proof_obligations: budget.proof_obligations || []
  });
}

const report = {
  schema_version: 1,
  runtime,
  metrics: {
    identities: metric('identities', identities),
    starts_and_resumes: metric('starts_and_resumes', startsAndResumes),
    models_and_effort: metric('models_and_effort', modelsAndEffort),
    delegation_decisions: metric('delegation_decisions', delegationMetric),
    routing: metric('routing', routingMetric),
    support_matrix: metric('support_matrix', supportMatrixMetric),
    tokens: metric('tokens', tokens),
    compactions: metric('compactions', aliasedUsageMetric('context_renewals', 'context_compactions', 'execution budget is absent')),
    research_events: metric('research_events', research),
    commands: metric('commands', commands),
    tests_by_evidence_class: metric('tests_by_evidence_class', testsByClass),
    complete_suite_executions: metric(
      'complete_suite_executions',
      usageMetric('complete_suite_executions', 'execution budget is absent')
    ),
    verification_receipts: metric(
      'verification_receipts',
      verification === null
        ? unavailable('verification receipts are absent')
        : observed({
          value: verification.length,
          passed: verification.filter(({ status }) => status === 'passed').length,
          failed: verification.filter(({ status }) => status === 'failed').length
        })
    ),
    reviews: metric(
      'reviews',
      dispatches === null
        ? unavailable('dispatch records are absent')
        : observed({ value: dispatches.filter(({ role }) => /review/i.test(String(role))).length })
    ),
    corrections: metric(
      'corrections',
      aliasedUsageMetric('correction_commits', 'final_correction_waves', 'execution budget is absent')
    ),
    rechecks: metric(
      'rechecks',
      aliasedUsageMetric('correction_rechecks', 'review_rechecks_per_seam', 'execution budget is absent')
    ),
    final_integration_reviews: metric(
      'final_integration_reviews',
      usageMetric('final_integration_reviews', 'execution budget is absent')
    ),
    convergence: metric(
      'convergence',
      convergenceDecisions === null
        ? unavailable('convergence decisions are absent')
        : observed({
          value: convergenceDecisions.length,
          continued: convergenceDecisions.filter(({ outcome }) => outcome === 'continue').length,
          escalated: convergenceDecisions.filter(({ outcome }) => outcome !== 'continue').length,
          reasons: [...new Set(convergenceDecisions.map(({ reason }) => reason))].sort()
        })
    ),
    time_by_phase: metric('time_by_phase', timeByPhase),
    budget_compliance: metric('budget_compliance', budgetCompliance)
  },
  inferences: [],
  unavailable_metrics: [...new Set(unavailableMetrics)].sort()
};

const identity = createHash('sha256').update(JSON.stringify(report)).digest('hex').slice(0, 24);
const directory = path.join(runtime, 'postmortems');
const reportPath = path.join(directory, `${identity}.json`);
await mkdir(directory, { recursive: true });
let status = 'created';
try {
  await readFile(reportPath, 'utf8');
  status = 'existing';
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}
writeLine(JSON.stringify({
  schema_version: 1,
  status,
  id: identity,
  unavailable_metrics: report.unavailable_metrics.length,
  report: reportPath
}));
