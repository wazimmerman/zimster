import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_CODEX_VERSION = '0.146.1';
const CONDITIONS = ['control', 'treatment'];
const FORBIDDEN_PROVIDER_ENV = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY',
  'CODEX_API_KEY'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertPilotSafety({
  loginStatus,
  codexVersion,
  autoTopUpConfirmedDisabled,
  planWindowState,
  environment = {}
}) {
  assert(/^Logged in using ChatGPT\s*$/m.test(loginStatus),
    'Codex pilot requires ChatGPT authentication; API-key authentication is prohibited.');
  assert(String(codexVersion).includes(REQUIRED_CODEX_VERSION),
    `Codex pilot requires CLI ${REQUIRED_CODEX_VERSION}; received ${String(codexVersion).trim()}.`);
  assert(autoTopUpConfirmedDisabled === true,
    'Auto top-up must be confirmed disabled before a subscription-backed run.');
  assert(typeof planWindowState === 'string' && planWindowState.trim(),
    'Record the visible subscription plan-window state without account identifiers.');
  for (const key of FORBIDDEN_PROVIDER_ENV) {
    assert(!environment[key], `${key} is prohibited: the pilot may not use an API key or alternate provider.`);
  }
  return {
    authentication: 'chatgpt_subscription',
    codex_version: REQUIRED_CODEX_VERSION,
    auto_top_up: 'confirmed_disabled',
    plan_window_state: planWindowState.trim()
  };
}

export function validateManifest(manifest) {
  assert(manifest?.schema_version === 1, 'Pilot manifest schema_version must be 1.');
  assert(manifest.conditions?.control && manifest.conditions?.treatment,
    'Pilot manifest requires control and treatment conditions.');
  assert(Array.isArray(manifest.tasks?.calibration) && manifest.tasks.calibration.length === 1,
    'Pilot manifest requires exactly one excluded calibration task.');
  assert(Array.isArray(manifest.tasks?.pilot) && manifest.tasks.pilot.length >= 8,
    'Pilot manifest requires at least eight frozen pilot tasks.');
  assert(manifest.campaigns?.minimum?.tasks === 6 && manifest.campaigns.minimum.repeats === 2,
    'Minimum campaign must be 6 tasks x 2 repeats.');
  assert(manifest.campaigns?.preferred?.tasks === 8 && manifest.campaigns.preferred.repeats === 3,
    'Preferred campaign must be 8 tasks x 3 repeats.');
  return manifest;
}

export function buildCampaign(manifest, campaignName) {
  validateManifest(manifest);
  let tasks;
  let repeats;
  let excluded = false;
  if (campaignName === 'calibration') {
    tasks = manifest.tasks.calibration;
    repeats = 1;
    excluded = true;
  } else {
    const campaign = manifest.campaigns?.[campaignName];
    assert(campaign, `Unknown campaign ${campaignName}.`);
    tasks = manifest.tasks.pilot.slice(0, campaign.tasks);
    repeats = campaign.repeats;
  }

  const runs = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const taskId = tasks[taskIndex];
      const pairId = `${taskId}:r${repeat}`;
      const order = (taskIndex + repeat) % 2 === 0 ? CONDITIONS : CONDITIONS.toReversed();
      for (let position = 0; position < order.length; position += 1) {
        runs.push({
          run_id: `${campaignName}-${String(runs.length + 1).padStart(2, '0')}-${order[position]}`,
          pair_id: pairId,
          task_id: taskId,
          repeat,
          condition: order[position],
          order_in_pair: position + 1,
          excluded_from_comparison: excluded,
          status: 'pending'
        });
      }
    }
  }
  return {
    schema_version: 1,
    manifest_id: manifest.id,
    campaign: campaignName,
    generated_at: null,
    runs
  };
}

export function completedPairedRecords(records) {
  const groups = new Map();
  for (const record of records.filter(({ excluded_from_comparison, scorable }) =>
    !excluded_from_comparison && scorable !== false)) {
    const group = groups.get(record.pair_id) ?? { pair_id: record.pair_id, task_id: record.task_id };
    if (CONDITIONS.includes(record.condition)) group[record.condition] = record;
    groups.set(record.pair_id, group);
  }
  return [...groups.values()].filter(({ control, treatment }) => control && treatment);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + remainder * (sorted[lower + 1] - sorted[lower]);
}

function rng(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clusterBootstrap(pairs, samples, seed) {
  const byTask = Map.groupBy(pairs, ({ task_id }) => task_id);
  const taskIds = [...byTask.keys()].toSorted();
  if (!taskIds.length) return { lower: null, upper: null, samples };
  const random = rng(seed);
  const estimates = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const differences = [];
    for (let draw = 0; draw < taskIds.length; draw += 1) {
      const taskId = taskIds[Math.floor(random() * taskIds.length)];
      for (const pair of byTask.get(taskId)) {
        differences.push(Number(pair.treatment.test_pass) - Number(pair.control.test_pass));
      }
    }
    estimates.push(mean(differences));
  }
  estimates.sort((a, b) => a - b);
  return {
    lower: quantile(estimates, 0.025),
    upper: quantile(estimates, 0.975),
    samples
  };
}

function metricSummary(records, metric, successOnly) {
  const subset = successOnly ? records.filter(({ success }) => success) : records;
  const control = subset.filter(({ condition, [metric]: value }) => condition === 'control' && Number.isFinite(value));
  const treatment = subset.filter(({ condition, [metric]: value }) => condition === 'treatment' && Number.isFinite(value));
  const controlMean = mean(control.map((record) => record[metric]));
  const treatmentMean = mean(treatment.map((record) => record[metric]));
  return {
    control_mean: controlMean,
    treatment_mean: treatmentMean,
    difference: controlMean === null || treatmentMean === null ? null : treatmentMean - controlMean,
    control_n: control.length,
    treatment_n: treatment.length
  };
}

function exactSignFlipPValue(differences) {
  const values = differences.filter(Number.isFinite);
  if (!values.length) return null;
  const observed = Math.abs(mean(values));
  if (values.length > 20) return null;
  const permutations = 2 ** values.length;
  let extreme = 0;
  for (let mask = 0; mask < permutations; mask += 1) {
    const estimate = mean(values.map((value, index) => (mask & (1 << index)) ? value : -value));
    if (Math.abs(estimate) + 1e-12 >= observed) extreme += 1;
  }
  return extreme / permutations;
}

function secondaryComparisons(pairs) {
  const definitions = [
    ['successful_completion', (record) => Number(record.success), false],
    ['wall_clock_seconds', (record) => record.wall_clock_seconds, false],
    ['turns', (record) => record.turns, false],
    ['input_tokens', (record) => record.input_tokens, false],
    ['cached_input_tokens', (record) => record.cached_input_tokens, false],
    ['output_tokens', (record) => record.output_tokens, false],
    ['tool_calls', (record) => record.tool_calls, false],
    ['retries', (record) => record.retries, false],
    ['wall_clock_seconds_success_only', (record) => record.wall_clock_seconds, true],
    ['turns_success_only', (record) => record.turns, true],
    ['input_tokens_success_only', (record) => record.input_tokens, true],
    ['output_tokens_success_only', (record) => record.output_tokens, true],
    ['tool_calls_success_only', (record) => record.tool_calls, true]
  ];
  const comparisons = [];
  for (const [id, valueOf, successOnly] of definitions) {
    const differences = [];
    for (const { control, treatment } of pairs) {
      if (successOnly && (!control.success || !treatment.success)) continue;
      const controlValue = valueOf(control);
      const treatmentValue = valueOf(treatment);
      if (Number.isFinite(controlValue) && Number.isFinite(treatmentValue)) {
        differences.push(treatmentValue - controlValue);
      }
    }
    const pValue = exactSignFlipPValue(differences);
    if (pValue !== null) comparisons.push({
      id,
      effect: 'treatment_minus_control',
      mean_difference: mean(differences),
      paired_n: differences.length,
      p_value: pValue
    });
  }
  return holmAdjust(comparisons);
}

function inverse2(matrix) {
  const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return [
    [matrix[1][1] / determinant, -matrix[0][1] / determinant],
    [-matrix[1][0] / determinant, matrix[0][0] / determinant]
  ];
}

function multiply2(left, right) {
  return [
    [left[0][0] * right[0][0] + left[0][1] * right[1][0], left[0][0] * right[0][1] + left[0][1] * right[1][1]],
    [left[1][0] * right[0][0] + left[1][1] * right[1][0], left[1][0] * right[0][1] + left[1][1] * right[1][1]]
  ];
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function fitComplementaryGee(pairs) {
  const clusters = Map.groupBy(pairs.flatMap(({ control, treatment }) => [control, treatment]), ({ task_id }) => task_id);
  if (clusters.size < 6) return {
    status: 'not_run',
    method: 'logistic_GEE_independence_task_clustered',
    task_clusters: clusters.size,
    reason: 'At least six completed task clusters are required.'
  };
  const observations = [...clusters.values()].flat().map((record) => ({
    x: record.condition === 'treatment' ? 1 : 0,
    y: Number(record.test_pass),
    task_id: record.task_id
  }));
  let beta = [0, 0];
  let bread;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    bread = [[0, 0], [0, 0]];
    const score = [0, 0];
    for (const { x, y } of observations) {
      const probability = Math.min(1 - 1e-8, Math.max(1e-8, 1 / (1 + Math.exp(-(beta[0] + beta[1] * x)))));
      const weight = probability * (1 - probability);
      const residual = y - probability;
      bread[0][0] += weight;
      bread[0][1] += weight * x;
      bread[1][0] += weight * x;
      bread[1][1] += weight * x * x;
      score[0] += residual;
      score[1] += residual * x;
    }
    const inverse = inverse2(bread);
    if (!inverse) return { status: 'unavailable', method: 'logistic_GEE_independence_task_clustered', task_clusters: clusters.size, reason: 'Singular estimating equations.' };
    const delta = [
      inverse[0][0] * score[0] + inverse[0][1] * score[1],
      inverse[1][0] * score[0] + inverse[1][1] * score[1]
    ];
    beta = [beta[0] + delta[0], beta[1] + delta[1]];
    if (Math.max(Math.abs(delta[0]), Math.abs(delta[1])) < 1e-9) break;
  }
  const inverseBread = inverse2(bread);
  if (!inverseBread || !beta.every(Number.isFinite)) return { status: 'unavailable', method: 'logistic_GEE_independence_task_clustered', task_clusters: clusters.size, reason: 'Model did not converge.' };
  const meat = [[0, 0], [0, 0]];
  for (const rows of clusters.values()) {
    const score = [0, 0];
    for (const record of rows) {
      const x = record.condition === 'treatment' ? 1 : 0;
      const probability = 1 / (1 + Math.exp(-(beta[0] + beta[1] * x)));
      const residual = Number(record.test_pass) - probability;
      score[0] += residual;
      score[1] += residual * x;
    }
    meat[0][0] += score[0] * score[0];
    meat[0][1] += score[0] * score[1];
    meat[1][0] += score[1] * score[0];
    meat[1][1] += score[1] * score[1];
  }
  const covariance = multiply2(multiply2(inverseBread, meat), inverseBread);
  const correction = clusters.size / (clusters.size - 1);
  const standardError = Math.sqrt(Math.max(0, covariance[1][1] * correction));
  const z = standardError > 0 ? beta[1] / standardError : null;
  return {
    status: 'fit',
    method: 'logistic_GEE_independence_task_clustered',
    task_clusters: clusters.size,
    treatment_log_odds: beta[1],
    treatment_odds_ratio: Math.exp(beta[1]),
    robust_standard_error: standardError,
    z_statistic: z,
    p_value: z === null ? null : 2 * (1 - normalCdf(Math.abs(z))),
    working_correlation: 'independence',
    small_sample_correction: 'G/(G-1)'
  };
}

export function holmAdjust(comparisons) {
  const sorted = comparisons.map((item, index) => ({ ...item, index }))
    .toSorted((a, b) => a.p_value - b.p_value);
  let previous = 0;
  const total = sorted.length;
  for (let index = 0; index < sorted.length; index += 1) {
    const adjusted = Math.min(1, (total - index) * sorted[index].p_value);
    sorted[index].adjusted_p_value = Math.max(previous, adjusted);
    previous = sorted[index].adjusted_p_value;
  }
  return sorted.toSorted((a, b) => a.index - b.index).map(({ index, ...item }) => item);
}

export function analyzeCampaign(records, { bootstrapSamples = 10_000, seed = 700 } = {}) {
  const eligible = records.filter(({ excluded_from_comparison }) => !excluded_from_comparison);
  const pairs = completedPairedRecords(eligible);
  const groupedCount = new Set(eligible.map(({ pair_id }) => pair_id)).size;
  const differences = pairs.map(({ control, treatment }) => Number(treatment.test_pass) - Number(control.test_pass));
  const metrics = [
    'wall_clock_seconds', 'turns', 'input_tokens', 'cached_input_tokens',
    'output_tokens', 'tool_calls', 'retries'
  ];
  return {
    schema_version: 1,
    primary: {
      outcome: 'benchmark_test_pass',
      control_pass_rate: mean(pairs.map(({ control }) => Number(control.test_pass))),
      treatment_pass_rate: mean(pairs.map(({ treatment }) => Number(treatment.test_pass))),
      paired_risk_difference: mean(differences),
      cluster_bootstrap_95_ci: clusterBootstrap(pairs, bootstrapSamples, seed)
    },
    pairs: {
      included: pairs.length,
      incomplete_excluded: groupedCount - pairs.length
    },
    efficiency: {
      unconditional: Object.fromEntries(metrics.map((metric) => [metric, metricSummary(eligible, metric, false)])),
      conditional_on_success: Object.fromEntries(metrics.map((metric) => [metric, metricSummary(eligible, metric, true)]))
    },
    secondary_comparisons: secondaryComparisons(pairs),
    complementary_model: fitComplementaryGee(pairs)
  };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildPierArgs({ taskPath, jobsDir, runId, condition }) {
  assert(CONDITIONS.includes(condition), `Unknown pilot condition ${condition}.`);
  return [
    'run',
    '--path', taskPath,
    '--agent', 'codex',
    '--model', 'gpt-5.6-sol',
    '--agent-kwarg', 'version=0.146.1',
    '--agent-kwarg', 'reasoning_effort=high',
    '--agent-env', 'CODEX_FORCE_AUTH_JSON=true',
    '--n-attempts', '1',
    '--n-concurrent', '1',
    '--max-retries', '0',
    '--job-name', runId,
    '--jobs-dir', jobsDir,
    '--yes'
  ];
}

export async function prepareTaskOverlay({ sourceTask, outputRoot, condition, skillsPath }) {
  assert(CONDITIONS.includes(condition), `Unknown pilot condition ${condition}.`);
  const destination = path.join(outputRoot, condition, path.basename(sourceTask));
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourceTask, destination, { recursive: true, dereference: false });
  if (condition === 'control') return destination;

  const taskFile = path.join(destination, 'task.toml');
  const originalTask = await readFile(taskFile, 'utf8');
  assert(!/^skills_dir\s*=/m.test(originalTask), 'Source task already declares skills_dir.');
  assert(/^\[environment\]$/m.test(originalTask), 'Task has no [environment] section.');
  const configuredTask = originalTask.replace(
    /^\[environment\]$/m,
    '[environment]\nskills_dir = "/zimster-skills"'
  );
  await writeFile(taskFile, configuredTask);

  const environmentDir = path.join(destination, 'environment');
  const embeddedSkills = path.join(environmentDir, 'zimster-skills');
  await cp(skillsPath, embeddedSkills, { recursive: true, dereference: false });
  const dockerfile = path.join(environmentDir, 'Dockerfile');
  const originalDockerfile = await readFile(dockerfile, 'utf8');
  await writeFile(dockerfile,
    `${originalDockerfile.replace(/\s*$/, '\n')}\n# Zimster treatment, frozen in the task build context.\nCOPY zimster-skills /zimster-skills\nRUN chmod -R a=rX /zimster-skills\n`);
  return destination;
}

function durationSeconds(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const value = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function recordFromPierResult(result, scheduledRun) {
  const reward = result?.verifier_result?.rewards?.reward;
  const context = result?.agent_result ?? {};
  return {
    ...scheduledRun,
    status: 'completed',
    scorable: Number.isFinite(reward),
    test_pass: reward === 1,
    benchmark_reward: Number.isFinite(reward) ? reward : null,
    success: !result?.exception_info && Boolean(result?.finished_at),
    wall_clock_seconds: durationSeconds(result?.started_at, result?.finished_at),
    turns: Number.isFinite(result?.n_agent_steps) ? result.n_agent_steps : (context.n_agent_steps ?? null),
    input_tokens: context.n_input_tokens ?? null,
    cached_input_tokens: context.n_cache_tokens ?? null,
    output_tokens: context.n_output_tokens ?? null,
    tool_calls: context.metadata?.tool_calls ?? null,
    retries: 0,
    failure_class: result?.exception_info?.exception_type ?? null
  };
}
