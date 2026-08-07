import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeCampaign,
  assertPilotSafety,
  buildPierArgs,
  buildCampaign,
  completedPairedRecords,
  countDirectoryEntries,
  holmAdjust,
  prepareTaskOverlay,
  recordFromPierResult
} from '../benchmarks/lib/pilot.mjs';
import { root } from './helpers.mjs';

const manifestPath = path.join(root, 'benchmarks/manifests/codex-pro-pilot.json');

async function manifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

test('benchmark lock pins DeepSWE, Pier, Codex, model, and reasoning', async () => {
  const lock = JSON.parse(await readFile(path.join(root, 'benchmarks/lock/deepswe-v1.1.json'), 'utf8'));
  assert.equal(lock.deepswe.commit, '435ee89ec2f2e2289f33b0da4f992f0b7b7266b9');
  assert.equal(lock.pier.commit, '0daf53d3599e58c4506cf0bcff5e12c77dc282d2');
  assert.equal(lock.codex.version, '0.146.1');
  assert.equal(lock.codex.model, 'gpt-5.6-sol');
  assert.equal(lock.codex.reasoning_effort, 'high');
  assert.equal(lock.deepswe.task_count, 113);
});

test('pinned source validation counts directory entries without detaching Dirent methods', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-directory-count-'));
  try {
    await mkdir(path.join(directory, 'first'));
    await mkdir(path.join(directory, 'second'));
    await writeFile(path.join(directory, 'not-a-directory'), 'fixture\n');
    assert.equal(countDirectoryEntries(await readdir(directory, { withFileTypes: true })), 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pilot scheduler emits excluded calibration and complete counterbalanced campaigns', async () => {
  const config = await manifest();
  const calibration = buildCampaign(config, 'calibration');
  assert.equal(calibration.runs.length, 2);
  assert.ok(calibration.runs.every(({ excluded_from_comparison }) => excluded_from_comparison));

  const minimum = buildCampaign(config, 'minimum');
  assert.equal(minimum.runs.length, 24);
  assert.equal(new Set(minimum.runs.map(({ pair_id }) => pair_id)).size, 12);
  for (let index = 0; index < minimum.runs.length; index += 2) {
    assert.deepEqual(new Set(minimum.runs.slice(index, index + 2).map(({ condition }) => condition)),
      new Set(['control', 'treatment']));
  }
  assert.notEqual(minimum.runs[0].condition, minimum.runs[2].condition);

  const preferred = buildCampaign(config, 'preferred');
  assert.equal(preferred.runs.length, 48);
  assert.equal(new Set(preferred.runs.map(({ pair_id }) => pair_id)).size, 24);
});

test('preflight permits only ChatGPT authentication and rejects paid/provider paths', () => {
  const base = {
    loginStatus: 'Logged in using ChatGPT',
    codexVersion: 'codex-cli 0.146.1',
    autoTopUpConfirmedDisabled: true,
    planWindowState: 'included usage available; identifiers omitted',
    environment: {}
  };
  assert.doesNotThrow(() => assertPilotSafety(base));
  assert.throws(() => assertPilotSafety({ ...base, loginStatus: 'Logged in using API key' }), /ChatGPT/);
  assert.throws(() => assertPilotSafety({ ...base, autoTopUpConfirmedDisabled: false }), /top-up/i);
  assert.throws(() => assertPilotSafety({ ...base, environment: { OPENAI_API_KEY: 'secret' } }), /OPENAI_API_KEY/);
  assert.throws(() => assertPilotSafety({ ...base, environment: { OPENAI_BASE_URL: 'https:\/\/other.invalid' } }), /provider/i);
  assert.throws(() => assertPilotSafety({ ...base, codexVersion: 'codex-cli 0.147.0' }), /0\.146\.1/);
});

test('incomplete pairs are excluded and paired risk difference is reproducible', () => {
  const records = [
    { pair_id: 'a:1', task_id: 'a', condition: 'control', test_pass: false, success: true, wall_clock_seconds: 20 },
    { pair_id: 'a:1', task_id: 'a', condition: 'treatment', test_pass: true, success: true, wall_clock_seconds: 18 },
    { pair_id: 'b:1', task_id: 'b', condition: 'control', test_pass: true, success: true, wall_clock_seconds: 30 },
    { pair_id: 'b:1', task_id: 'b', condition: 'treatment', test_pass: true, success: true, wall_clock_seconds: 28 },
    { pair_id: 'c:1', task_id: 'c', condition: 'control', test_pass: false, success: false, wall_clock_seconds: 40 }
  ];
  assert.equal(completedPairedRecords(records).length, 2);
  const first = analyzeCampaign(records, { bootstrapSamples: 500, seed: 73 });
  const second = analyzeCampaign(records, { bootstrapSamples: 500, seed: 73 });
  assert.deepEqual(first, second);
  assert.equal(first.primary.paired_risk_difference, 0.5);
  assert.equal(first.pairs.included, 2);
  assert.equal(first.pairs.incomplete_excluded, 1);
  assert.ok(first.efficiency.unconditional.wall_clock_seconds);
  assert.ok(first.efficiency.conditional_on_success.wall_clock_seconds);
  assert.ok(first.secondary_comparisons.every(({ adjusted_p_value }) => Number.isFinite(adjusted_p_value)));
});

test('complementary clustered logistic GEE is fitted when six task clusters are complete', () => {
  const records = [];
  for (let index = 0; index < 6; index += 1) {
    records.push(
      { pair_id: `t${index}:r1`, task_id: `t${index}`, condition: 'control', test_pass: index >= 4, success: true },
      { pair_id: `t${index}:r1`, task_id: `t${index}`, condition: 'treatment', test_pass: index >= 2, success: true }
    );
  }
  const analysis = analyzeCampaign(records, { bootstrapSamples: 50, seed: 5 });
  assert.equal(analysis.complementary_model.status, 'fit');
  assert.equal(analysis.complementary_model.method, 'logistic_GEE_independence_task_clustered');
  assert.equal(analysis.complementary_model.task_clusters, 6);
  assert.ok(Number.isFinite(analysis.complementary_model.treatment_log_odds));
  assert.ok(Number.isFinite(analysis.complementary_model.robust_standard_error));
});

test('Holm correction is monotone in sorted p-value order', () => {
  const adjusted = holmAdjust([
    { id: 'a', p_value: 0.01 },
    { id: 'b', p_value: 0.04 },
    { id: 'c', p_value: 0.03 }
  ]);
  const sorted = adjusted.toSorted((a, b) => a.p_value - b.p_value);
  assert.deepEqual(sorted.map(({ adjusted_p_value }) => adjusted_p_value), [0.03, 0.06, 0.06]);
});

test('Pier invocation freezes Codex settings without provider or unsafe mount overrides', () => {
  const common = {
    taskPath: '/evidence/tasks/example', jobsDir: '/evidence/jobs', runId: 'run-01',
    authHome: '/home/operator/.codex', skillsPath: '/src/skills'
  };
  const control = buildPierArgs({ ...common, condition: 'control' });
  const treatment = buildPierArgs({ ...common, condition: 'treatment' });
  for (const args of [control, treatment]) {
    assert.ok(args.includes('gpt-5.6-sol'));
    assert.ok(args.includes('version=0.146.1'));
    assert.ok(args.includes('reasoning_effort=high'));
    assert.ok(args.includes('CODEX_FORCE_AUTH_JSON=true'));
    assert.ok(args.includes('1'));
    assert.ok(!args.some((arg) => arg.includes('OPENAI_API_KEY')));
  }
  assert.ok(!control.includes('--mounts-json'));
  assert.ok(!treatment.includes('--mounts-json'));
});

test('treatment task overlay embeds canonical skills while control remains plugin-free', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zimster-pilot-overlay-'));
  try {
    const source = path.join(directory, 'source');
    const skills = path.join(directory, 'skills');
    await mkdir(path.join(source, 'environment'), { recursive: true });
    await mkdir(path.join(skills, 'using-zimster'), { recursive: true });
    await writeFile(path.join(source, 'task.toml'), '[environment]\ndocker_image = "fixture"\n');
    await writeFile(path.join(source, 'environment', 'Dockerfile'), 'FROM scratch\n');
    await writeFile(path.join(skills, 'using-zimster', 'SKILL.md'), '---\nname: using-zimster\n---\n');
    const control = await prepareTaskOverlay({ sourceTask: source, outputRoot: path.join(directory, 'out'), condition: 'control', skillsPath: skills });
    const treatment = await prepareTaskOverlay({ sourceTask: source, outputRoot: path.join(directory, 'out'), condition: 'treatment', skillsPath: skills });
    assert.doesNotMatch(await readFile(path.join(control, 'task.toml'), 'utf8'), /skills_dir/);
    assert.match(await readFile(path.join(treatment, 'task.toml'), 'utf8'), /skills_dir = "\/zimster-skills"/);
    assert.match(await readFile(path.join(treatment, 'environment', 'Dockerfile'), 'utf8'), /COPY zimster-skills/);
    assert.match(await readFile(path.join(treatment, 'environment', 'zimster-skills', 'using-zimster', 'SKILL.md'), 'utf8'), /using-zimster/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Pier result import records deterministic-test authority and exposed efficiency fields', () => {
  const record = recordFromPierResult({
    task_name: 'example',
    started_at: '2026-08-07T00:00:00Z',
    finished_at: '2026-08-07T00:02:00Z',
    verifier_result: { rewards: { reward: 1 } },
    agent_result: {
      n_input_tokens: 100, n_cache_tokens: 40, n_output_tokens: 12,
      n_agent_steps: 7, metadata: { tool_calls: 9 }
    },
    exception_info: null
  }, { pair_id: 'example:r1', task_id: 'example', condition: 'treatment', repeat: 1 });
  assert.equal(record.test_pass, true);
  assert.equal(record.success, true);
  assert.equal(record.wall_clock_seconds, 120);
  assert.equal(record.turns, 7);
  assert.equal(record.input_tokens, 100);
  assert.equal(record.cached_input_tokens, 40);
  assert.equal(record.output_tokens, 12);
  assert.equal(record.tool_calls, 9);
  assert.equal(record.failure_class, null);
});
