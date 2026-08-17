import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJsonl(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function jsonDirectory(directory) {
  try {
    const result = [];
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.json')).sort()) {
      result.push({ name, value: JSON.parse(await readFile(path.join(directory, name), 'utf8')) });
    }
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function currentRunRows(rows, run, timestampFields) {
  if (rows === null || !run) return rows;
  const startedAt = Date.parse(run.started_at);
  return rows.filter((row) => {
    if (row.run_id) return row.run_id === run.id;
    return timestampFields.some((field) => {
      const timestamp = Date.parse(row[field]);
      return Number.isFinite(timestamp) && timestamp >= startedAt;
    });
  });
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function postmortemStateBinding(runtime) {
  const run = await optionalJson(path.join(runtime, 'run.json'));
  const eventTypes = new Set([
    'run_started', 'run_resumed', 'token_meter', 'research', 'phase_duration'
  ]);
  const sources = {
    run_scope: run ? {
      id: run.id,
      root_actor_id: run.root_actor_id,
      started_at: run.started_at,
      starting_head: run.starting_head
    } : null,
    budget: await optionalJson(path.join(runtime, 'budget.json')),
    host_verification: await optionalJson(path.join(runtime, 'host-smoke', 'latest.json')),
    dispatches: currentRunRows(
      await optionalJsonl(path.join(runtime, 'dispatches', 'dispatches.jsonl')),
      run,
      ['created_at', 'completed_at']
    ),
    delegation_decisions: currentRunRows(
      await optionalJsonl(path.join(runtime, 'delegation', 'decisions.jsonl')),
      run,
      ['created_at']
    ),
    routing_proposals: currentRunRows(
      await optionalJsonl(path.join(runtime, 'routing', 'proposals.jsonl')),
      run,
      ['created_at']
    ),
    routing_resolutions: currentRunRows(
      await optionalJsonl(path.join(runtime, 'routing', 'resolutions.jsonl')),
      run,
      ['created_at']
    ),
    convergence_decisions: currentRunRows(
      await optionalJsonl(path.join(runtime, 'convergence', 'decisions.jsonl')),
      run,
      ['created_at']
    ),
    evidence: currentRunRows(
      await optionalJsonl(path.join(runtime, 'evidence', 'receipts.jsonl')),
      run,
      ['ended_at', 'started_at', 'recorded_at']
    ),
    metric_events: currentRunRows(
      await optionalJsonl(path.join(runtime, 'events', 'events.jsonl')),
      run,
      ['recorded_at']
    )?.filter((row) => eventTypes.has(row.event_type)) ?? null,
    verification_suites: currentRunRows(
      (await jsonDirectory(path.join(runtime, 'verification', 'receipts')))
        ?.map(({ value }) => value) ?? null,
      run,
      ['started_at', 'ended_at']
    ),
    review_lifecycles: await jsonDirectory(path.join(runtime, 'review-lifecycle')),
    review_attempts: await optionalJsonl(path.join(runtime, 'review-lifecycle', 'attempts.jsonl')),
    assurance_accounting: await optionalJson(
      path.join(runtime, 'assurance-accounting', 'latest.json')
    )
  };
  const sourceDigests = Object.fromEntries(
    Object.entries(sources).map(([name, value]) => [name, digest(value)])
  );
  return {
    schema_version: 1,
    status: 'supported',
    source_digests: sourceDigests,
    sha256: digest(sourceDigests)
  };
}

export async function validatePostmortemState(report, runtime) {
  if (!report?.source_state || report.source_state.schema_version !== 1
    || report.source_state.status !== 'supported') {
    return { current: false, reason: 'postmortem durable source-state binding is absent or disproven' };
  }
  const current = await postmortemStateBinding(runtime);
  if (report.source_state.sha256 !== current.sha256
    || JSON.stringify(report.source_state.source_digests)
      !== JSON.stringify(current.source_digests)) {
    return { current: false, reason: 'postmortem durable source state changed', current_binding: current };
  }
  return { current: true, reason: null, current_binding: current };
}
