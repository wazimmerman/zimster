import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  postmortemStateBinding,
  validatePostmortemState
} from '../scripts/lib/postmortem-state.mjs';

function run(args, cwd = root) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/run-postmortem.mjs'),
    ...args
  ], { cwd, encoding: 'utf8' });
}

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function jsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('run postmortem aggregates observed execution economy without mixing token meters', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-postmortem-'));
  try {
    await json(path.join(runtime, 'run.json'), {
      schema_version: 1,
      id: 'current-run',
      root_actor_id: 'root',
      started_at: '2026-07-28T00:00:00.000Z',
      starting_head: '0123456789abcdef0123456789abcdef01234567'
    });
    await json(path.join(runtime, 'budget.json'), {
      schema_version: 1,
      profile: 'high-risk',
      limits: {
        complete_suite_executions: 3,
        exact_duplicate_commands: 2,
        review_rechecks_per_seam: 1,
        final_correction_waves: 1,
        optional_deliberate_agents: 5,
        nesting_depth: 1,
        context_compactions: 2,
        research_refreshes: 1
      },
      usage: {
        complete_suite_executions: 1,
        exact_duplicate_commands: 1,
        review_rechecks_per_seam: 2,
        final_correction_waves: 2,
        optional_deliberate_agents: 1,
        nesting_depth: 1,
        context_compactions: 1,
        research_refreshes: 0
      },
      optional_agent_identities: ['reviewer-1'],
      scoped_usage: {
        review_rechecks_per_seam: {
          execution_state: 1,
          final_integration: 1
        }
      },
      overrides: [{ metric: 'final_correction_waves' }],
      proof_obligations: [{
        proof: 'release proof',
        status: 'required',
        metric: 'final_correction_waves'
      }]
    });
    await jsonl(path.join(runtime, 'dispatches/dispatches.jsonl'), [{
      schema_version: 2,
      id: 'dispatch-1',
      run_id: 'current-run',
      delegation_id: 'delegation-1',
      proposal_id: 'proposal-1',
      role: 'reviewer',
      agent_id: 'reviewer-1',
      requested_model: 'mapped-reviewer',
      requested_effort: 'high',
      effective_model: 'gpt-5.6-sol',
      effective_effort: 'high',
      fallback_trace: ['mapped'],
      owner_acceptance: { status: 'accepted', proof: 'review proof' },
      created_at: '2026-07-28T00:05:00.000Z',
      completed_at: '2026-07-28T00:10:00.000Z'
    }, {
      id: 'archived-dispatch',
      role: 'reviewer',
      agent_id: 'archived-reviewer',
      effective_model: 'old-model',
      effective_effort: 'old-effort',
      created_at: '2026-07-27T00:00:00.000Z',
      completed_at: '2026-07-27T00:10:00.000Z'
    }]);
    await jsonl(path.join(runtime, 'delegation/decisions.jsonl'), [{
      id: 'delegation-inline', run_id: 'current-run', selected: false,
      created_at: '2026-07-28T00:01:00.000Z'
    }, {
      id: 'delegation-1', run_id: 'current-run', selected: true,
      created_at: '2026-07-28T00:02:00.000Z'
    }]);
    await jsonl(path.join(runtime, 'routing/proposals.jsonl'), [{
      id: 'proposal-1', run_id: 'current-run', status: 'consumed',
      phase: 'dispatch', authority: 'authoritative',
      created_at: '2026-07-28T00:03:00.000Z'
    }, {
      id: 'cancelled-proposal', run_id: 'current-run', status: 'cancelled',
      phase: 'dispatch', authority: 'authoritative',
      created_at: '2026-07-28T00:04:00.000Z'
    }]);
    await jsonl(path.join(runtime, 'routing/resolutions.jsonl'), [{
      id: 'resolution-1', run_id: 'current-run', proposal_id: 'proposal-1',
      action: 'request', fallback_trace: ['mapped'],
      requested_model: 'mapped-reviewer', requested_effort: 'high',
      created_at: '2026-07-28T00:04:00.000Z'
    }, {
      id: 'resolution-2', run_id: 'current-run', proposal_id: 'cancelled-proposal',
      action: 'cancel', fallback_trace: ['strict_cost_unenforceable'],
      requested_model: 'none', requested_effort: 'none',
      created_at: '2026-07-28T00:04:30.000Z'
    }]);
    await jsonl(path.join(runtime, 'convergence/decisions.jsonl'), [{
      schema_version: 1, id: 'convergence-1', run_id: 'current-run',
      event: 'focused_test_failure', outcome: 'continue',
      reason: 'ordinary_deterministic_in_scope_failure', scope: 'in-scope',
      sensitivity: 'ordinary', metric: 'correction_commits', used: 0, limit: 1,
      created_at: '2026-07-28T00:04:45.000Z'
    }]);
    await jsonl(path.join(runtime, 'events/events.jsonl'), [
      {
        event_type: 'run_started',
        actor_id: 'root',
        recorded_at: '2026-07-28T00:00:00.000Z'
      },
      {
        event_type: 'run_resumed',
        actor_id: 'root',
        recorded_at: '2026-07-28T01:00:00.000Z'
      },
      {
        event_type: 'token_meter',
        meter: 'goal_meter',
        compatibility_group: 'goal_meter',
        tokens: 1000,
        recorded_at: '2026-07-28T01:01:00.000Z'
      },
      {
        event_type: 'token_meter',
        meter: 'raw_input',
        compatibility_group: 'raw_input',
        tokens: 9000,
        recorded_at: '2026-07-28T01:01:00.000Z'
      },
      {
        event_type: 'phase_duration',
        phase: 'implementation',
        duration_ms: 120000,
        recorded_at: '2026-07-28T01:02:00.000Z'
      }
    ]);
    await jsonl(path.join(runtime, 'evidence/receipts.jsonl'), [
      {
        id: 'test-1',
        record_type: 'receipt',
        command_identity: 'same-command',
        command: 'node --test',
        kind: 'affected',
        exit_code: 0,
        tests: { discovery: 'tests_executed', passed: 3, failed: 0, skipped: 0 },
        ended_at: '2026-07-28T00:20:00.000Z'
      },
      {
        id: 'test-2',
        record_type: 'receipt',
        command_identity: 'same-command',
        command: 'node --test',
        kind: 'affected',
        exit_code: 0,
        tests: { discovery: 'tests_executed', passed: 3, failed: 0, skipped: 0 },
        ended_at: '2026-07-28T00:21:00.000Z'
      },
      {
        id: 'archived-test',
        record_type: 'receipt',
        command_identity: 'archived-command',
        command: 'old broad command',
        kind: 'affected',
        exit_code: 0,
        tests: { discovery: 'tests_executed', passed: 99, failed: 0, skipped: 0 },
        ended_at: '2026-07-27T00:21:00.000Z'
      }
    ]);
    await json(path.join(runtime, 'verification/receipts/suite.json'), {
      id: 'suite',
      profile: 'goal',
      status: 'passed',
      started_at: '2026-07-28T00:30:00.000Z',
      steps: [{
        id: 'tests',
        status: 'passed',
        command_identity: 'verification-tests',
        command_argv: ['node', '--test']
      }]
    });
    await json(path.join(runtime, 'verification/receipts/archived.json'), {
      id: 'archived-suite',
      profile: 'goal',
      status: 'passed',
      started_at: '2026-07-27T00:30:00.000Z',
      steps: [{ id: 'tests', status: 'passed' }]
    });

    const result = run([
      '--runtime', runtime,
      '--now', '2026-07-28T02:00:00.000Z'
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.length < 2000);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'created');
    const report = JSON.parse(await readFile(summary.report, 'utf8'));
    const latest = JSON.parse(await readFile(path.join(runtime, 'postmortems', 'latest.json'), 'utf8'));
    assert.deepEqual(latest, report);

    assert.equal(report.source_state.schema_version, 1);
    assert.match(report.source_state.sha256, /^[0-9a-f]{64}$/);
    assert.equal(report.source_state.status, 'supported');

    assert.equal(report.metrics.identities.observation, 'observed');
    assert.deepEqual(report.metrics.identities.root, ['root']);
    assert.deepEqual(report.metrics.identities.subagents, ['reviewer-1']);
    assert.equal(report.metrics.starts_and_resumes.starts, 1);
    assert.equal(report.metrics.starts_and_resumes.resumes, 1);
    assert.equal(report.metrics.commands.observation, 'partial');
    assert.equal(report.metrics.commands.exact_duplicate_executions, 1);
    assert.equal(report.metrics.commands.executions, 3);
    assert.equal(report.metrics.tests_by_evidence_class.affected.passed, 6);
    assert.equal(report.metrics.complete_suite_executions.value, 1);
    assert.equal(report.metrics.verification_receipts.value, 1);
    assert.equal(report.metrics.reviews.value, 1);
    assert.equal(report.metrics.delegation_decisions.selected, 1);
    assert.equal(report.metrics.delegation_decisions.inline, 1);
    assert.equal(report.metrics.routing.proposals, 2);
    assert.equal(report.metrics.routing.cancelled_dispatches, 1);
    assert.equal(report.metrics.routing.owner_accepted, 1);
    assert.equal(report.metrics.routing.effective_mismatches, 1);
    assert.equal(report.metrics.convergence.continued, 1);
    assert.deepEqual(report.metrics.routing.fallbacks, ['mapped', 'strict_cost_unenforceable']);
    assert.equal(report.metrics.corrections.value, 2);
    assert.equal(report.metrics.rechecks.value, 2);
    assert.equal(
      report.metrics.budget_compliance.exceeded.includes('review_rechecks_per_seam'),
      false
    );
    assert.deepEqual(
      report.metrics.tokens.meters.map(({ meter, tokens }) => [meter, tokens]),
      [['goal_meter', 1000], ['raw_input', 9000]]
    );
    assert.equal(Object.hasOwn(report.metrics.tokens, 'total'), false);
    assert.equal(report.metrics.budget_compliance.status, 'noncompliant');
    assert.deepEqual(report.unavailable_metrics, ['research_events', 'support_matrix']);

    const current = run(['check', '--runtime', runtime, '--file', summary.report]);
    assert.equal(current.status, 0, current.stderr || current.stdout);
    assert.match(current.stdout, /POSTMORTEM_CURRENT/);

    const changedBudget = JSON.parse(await readFile(path.join(runtime, 'budget.json'), 'utf8'));
    changedBudget.usage.complete_suite_executions += 1;
    await json(path.join(runtime, 'budget.json'), changedBudget);
    const stale = run(['check', '--runtime', runtime, '--file', summary.report]);
    assert.equal(stale.status, 2, stale.stderr || stale.stdout);
    assert.match(stale.stdout, /POSTMORTEM_STALE/);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test('run postmortem labels absent measurements unavailable instead of inferring zero', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-postmortem-empty-'));
  try {
    const result = run([
      '--runtime', runtime,
      '--now', '2026-07-28T02:00:00.000Z'
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(JSON.parse(result.stdout).report, 'utf8'));
    assert.equal(report.metrics.tokens.observation, 'unavailable');
    assert.equal(report.metrics.commands.observation, 'unavailable');
    assert.ok(report.unavailable_metrics.includes('tokens'));
    assert.ok(report.unavailable_metrics.includes('commands'));
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test('postmortem binding covers budgets, dispatches, reviews, evidence, and suites', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'zimster-postmortem-binding-'));
  try {
    const fixtures = [
      ['budget.json', { usage: { complete_suite_executions: 1 } }],
      ['dispatches/dispatches.jsonl', [{ id: 'dispatch-1', role: 'reviewer' }]],
      ['review-lifecycle/whole-release.json', { seam_id: 'whole-release', state: 'approved' }],
      ['evidence/receipts.jsonl', [{ id: 'evidence-1', exit_code: 0 }]],
      ['verification/receipts/suite.json', { id: 'suite-1', status: 'passed' }]
    ];
    for (const [relative, value] of fixtures) {
      const file = path.join(runtime, relative);
      if (relative.endsWith('.jsonl')) await jsonl(file, value);
      else await json(file, value);
    }
    const report = { source_state: await postmortemStateBinding(runtime) };
    assert.equal((await validatePostmortemState(report, runtime)).current, true);

    for (const [relative, value] of fixtures) {
      const file = path.join(runtime, relative);
      const changed = relative.endsWith('.jsonl')
        ? [...value, { id: `changed-${relative}` }]
        : { ...value, changed: true };
      if (relative.endsWith('.jsonl')) await jsonl(file, changed);
      else await json(file, changed);
      assert.equal(
        (await validatePostmortemState(report, runtime)).current,
        false,
        relative
      );
      if (relative.endsWith('.jsonl')) await jsonl(file, value);
      else await json(file, value);
    }
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});
