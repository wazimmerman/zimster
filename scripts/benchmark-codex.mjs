#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  appendFile, mkdir, readFile, readdir, rename, rm, writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeCampaign,
  assertPilotSafety,
  buildCampaign,
  buildPierArgs,
  countDirectoryEntries,
  prepareTaskOverlay,
  redactEvidenceTree,
  redactSensitiveText,
  recordFromPierResult,
  sha256,
  validateManifest
} from '../benchmarks/lib/pilot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = path.join(root, 'benchmarks/manifests/codex-pro-pilot.json');
const lockPath = path.join(root, 'benchmarks/lock/deepswe-v1.1.json');
const forbiddenEnv = [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY', 'CODEX_API_KEY'
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail(`Unexpected argument ${token}.`);
    const key = token.slice(2);
    if (['confirm-auto-top-up-disabled', 'resume'].includes(key)) options[key] = true;
    else {
      if (rest[index + 1] === undefined || rest[index + 1].startsWith('--')) fail(`Missing value for ${token}.`);
      options[key] = rest[index + 1];
      index += 1;
    }
  }
  return { command, options };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function livePreflight(options) {
  const version = run('codex', ['--version']);
  if (version.status !== 0) fail(version.stderr || 'codex --version failed.');
  const login = run('codex', ['login', 'status']);
  if (login.status !== 0) fail(login.stderr || 'codex login status failed.');
  return assertPilotSafety({
    loginStatus: `${login.stdout}\n${login.stderr}`,
    codexVersion: `${version.stdout}\n${version.stderr}`,
    autoTopUpConfirmedDisabled: options['confirm-auto-top-up-disabled'] === true,
    planWindowState: options['plan-window-state'],
    environment: process.env
  });
}

function safeEnvironment() {
  const environment = { ...process.env };
  for (const key of forbiddenEnv) delete environment[key];
  return environment;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function gitHead(directory) {
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: directory });
  if (result.status !== 0) fail(`Cannot resolve pinned source at ${directory}: ${result.stderr}`);
  return result.stdout.trim();
}

async function validateSources(deepswe, pier, lock) {
  if (await gitHead(deepswe) !== lock.deepswe.commit) fail('DeepSWE checkout does not match the lock commit.');
  if (await gitHead(pier) !== lock.pier.commit) fail('Pier checkout does not match the lock commit.');
  const taskEntries = await readdir(path.join(deepswe, 'tasks'), { withFileTypes: true });
  const count = countDirectoryEntries(taskEntries);
  if (count !== lock.deepswe.task_count) fail(`DeepSWE task count mismatch: expected ${lock.deepswe.task_count}, received ${count}.`);
}

async function filesUnder(directory, base = directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(absolute, base));
    else if (entry.isFile()) output.push({ absolute, relative: path.relative(base, absolute).split(path.sep).join('/') });
  }
  return output;
}

async function contentAddressBundle(jobDirectory, bundleRoot) {
  await redactEvidenceTree(jobDirectory);
  const files = (await filesUnder(jobDirectory)).toSorted((a, b) => a.relative.localeCompare(b.relative));
  const inventory = [];
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    inventory.push({ path: file.relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const canonical = `${JSON.stringify(inventory)}\n`;
  const digest = sha256(canonical);
  const destination = path.join(bundleRoot, 'sha256', digest);
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(jobDirectory, destination);
  await writeJson(path.join(destination, 'bundle-manifest.json'), {
    schema_version: 1,
    digest: `sha256:${digest}`,
    files: inventory
  });
  return digest;
}

async function findResult(directory) {
  const files = await filesUnder(directory);
  const matches = files.filter(({ relative }) => relative.endsWith('/result.json') || relative === 'result.json');
  if (matches.length !== 1) fail(`Expected one Pier result.json in ${directory}; found ${matches.length}.`);
  return matches[0].absolute;
}

async function enrichWithTrajectory(result, jobDirectory) {
  const files = await filesUnder(jobDirectory);
  const trajectory = files.find(({ relative }) => relative.endsWith('/trajectory.json'));
  if (!trajectory) return result;
  try {
    const data = await readJson(trajectory.absolute);
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const toolCalls = steps.reduce((count, step) =>
      count + (Array.isArray(step.tool_calls) ? step.tool_calls.length : 0), 0);
    result.agent_result ??= {};
    result.agent_result.metadata ??= {};
    result.agent_result.metadata.tool_calls = toolCalls;
  } catch {
    // The canonical Pier result remains authoritative when optional ATIF parsing fails.
  }
  return result;
}

function usageLimitSeen(output) {
  return /(included usage|usage limit|rate limit|quota).*(reached|exceeded|reset|unavailable)|purchase credits|upgrade your plan/i.test(output);
}

async function runCampaign(options) {
  const manifest = validateManifest(await readJson(options.manifest ?? defaultManifest));
  const lock = await readJson(lockPath);
  const campaignName = options.campaign;
  if (!['calibration', 'minimum', 'preferred'].includes(campaignName)) fail('Use --campaign calibration, minimum, or preferred.');
  if (!options.deepswe || !options.pier) fail('Run requires --deepswe and --pier pinned source paths.');
  await validateSources(options.deepswe, options.pier, lock);
  const preflight = livePreflight(options);

  const gitDirectory = run('git', ['rev-parse', '--git-dir'], { cwd: root });
  if (gitDirectory.status !== 0) fail(gitDirectory.stderr);
  const resolvedGitDirectory = path.resolve(root, gitDirectory.stdout.trim());
  const stateDir = options['state-dir'] ?? path.join(resolvedGitDirectory, 'zimster', 'benchmarks', manifest.id, campaignName);
  const campaignFile = path.join(stateDir, 'campaign.json');
  const recordsFile = path.join(stateDir, 'records.jsonl');
  const preflightFile = path.join(stateDir, 'preflight.json');
  await mkdir(stateDir, { recursive: true });

  let campaign;
  try {
    campaign = await readJson(campaignFile);
    if (!options.resume) fail(`${campaignFile} exists; pass --resume or choose another state directory.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    campaign = buildCampaign(manifest, campaignName);
    campaign.generated_at = new Date().toISOString();
    await writeJson(campaignFile, campaign);
  }
  await writeJson(preflightFile, {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    ...preflight,
    account_identifiers_recorded: false,
    forbidden_provider_environment_present: false
  });

  let records = [];
  try {
    records = (await readFile(recordsFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const completedIds = new Set(records.map(({ run_id }) => run_id));
  const pendingPairs = Map.groupBy(campaign.runs.filter(({ run_id }) => !completedIds.has(run_id)), ({ pair_id }) => pair_id);
  const maxPairs = options['max-pairs'] ? Number(options['max-pairs']) : Number.POSITIVE_INFINITY;
  if (!Number.isInteger(maxPairs) && maxPairs !== Number.POSITIVE_INFINITY) fail('--max-pairs must be an integer.');
  let pairsStarted = 0;
  let stopAfterPair = false;

  for (const pairRuns of pendingPairs.values()) {
    if (pairsStarted >= maxPairs || stopAfterPair) break;
    pairsStarted += 1;
    for (const scheduledRun of pairRuns.toSorted((a, b) => a.order_in_pair - b.order_in_pair)) {
      // Recheck live authentication immediately before every chargeable run.
      livePreflight(options);
      const sourceTask = path.join(options.deepswe, 'tasks', scheduledRun.task_id);
      const taskPath = await prepareTaskOverlay({
        sourceTask,
        outputRoot: path.join(stateDir, 'prepared'),
        condition: scheduledRun.condition,
        skillsPath: path.join(root, 'skills')
      });
      const jobsDir = path.join(stateDir, 'jobs');
      const pierArgs = buildPierArgs({
        taskPath, jobsDir, runId: scheduledRun.run_id, condition: scheduledRun.condition
      });
      const startedAt = new Date().toISOString();
      const execution = run('uv', ['run', '--project', options.pier, 'pier', ...pierArgs], {
        cwd: root,
        env: safeEnvironment(),
        timeout: 7_800_000,
        maxBuffer: 50 * 1024 * 1024
      });
      const combinedOutput = redactSensitiveText(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`);
      if (usageLimitSeen(combinedOutput)) stopAfterPair = true;

      const jobDirectory = path.join(jobsDir, scheduledRun.run_id);
      await mkdir(jobDirectory, { recursive: true });
      await writeFile(path.join(jobDirectory, 'runner.log'), combinedOutput);
      let record;
      try {
        const resultFile = await findResult(jobDirectory);
        const result = await enrichWithTrajectory(await readJson(resultFile), jobDirectory);
        record = recordFromPierResult(result, scheduledRun);
        record.runner_exit_code = execution.status;
        record.raw_bundle_sha256 = await contentAddressBundle(jobDirectory, path.join(stateDir, 'bundles'));
      } catch (error) {
        record = {
          ...scheduledRun,
          status: 'failed',
          scorable: false,
          test_pass: false,
          success: false,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          runner_exit_code: execution.status,
          failure_class: usageLimitSeen(combinedOutput) ? 'included_usage_limit' : 'harness_failure',
          failure_message: redactSensitiveText(error.message)
        };
        record.raw_bundle_sha256 = await contentAddressBundle(jobDirectory, path.join(stateDir, 'bundles'));
      }
      await appendFile(recordsFile, `${JSON.stringify(record)}\n`);
      records.push(record);
    }
  }

  const analysis = analyzeCampaign(records);
  await writeJson(path.join(stateDir, 'analysis.json'), analysis);
  await writeJson(path.join(stateDir, 'public-evidence.json'), {
    schema_version: 1,
    manifest_sha256: sha256(`${JSON.stringify(manifest)}\n`),
    lock_sha256: sha256(await readFile(lockPath)),
    campaign: campaignName,
    complete_pairs: analysis.pairs.included,
    raw_bundle_sha256: records.map(({ run_id, raw_bundle_sha256 }) => ({ run_id, sha256: raw_bundle_sha256 ?? null })),
    analysis
  });
  process.stdout.write(`${stateDir}\n`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'preflight') {
    const receipt = { schema_version: 1, checked_at: new Date().toISOString(), ...livePreflight(options) };
    if (options.output) await writeJson(options.output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command === 'plan') {
    const manifest = await readJson(options.manifest ?? defaultManifest);
    const campaign = buildCampaign(manifest, options.campaign);
    campaign.generated_at = new Date().toISOString();
    if (options.output) await writeJson(options.output, campaign);
    process.stdout.write(`${JSON.stringify(campaign, null, 2)}\n`);
    return;
  }
  if (command === 'analyze') {
    if (!options.records) fail('analyze requires --records <jsonl>.');
    const records = (await readFile(options.records, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const analysis = analyzeCampaign(records, {
      bootstrapSamples: options['bootstrap-samples'] ? Number(options['bootstrap-samples']) : 10_000,
      seed: options.seed ? Number(options.seed) : 700
    });
    if (options.output) await writeJson(options.output, analysis);
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    return;
  }
  if (command === 'run') {
    await runCampaign(options);
    return;
  }
  fail('Usage: benchmark-codex.mjs <preflight|plan|run|analyze> [options]');
}

main().catch((error) => {
  process.stderr.write(`benchmark-codex: ${redactSensitiveText(error.stack ?? error.message)}\n`);
  process.exitCode = 1;
});
