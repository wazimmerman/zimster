import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parseOptions, required, integerOption } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory, migrateLegacyJsonlStore } from './lib/runtime.mjs';
import { harnessCapabilities } from './lib/capabilities.mjs';

const { positional, options, passthrough } = parseOptions(process.argv.slice(2));
const commandName = positional[0];
const root = findRepoRoot(process.cwd());
let evidenceDir;
let receiptsFile;

async function init() {
  const runtime = await ensureRuntimeDirectory(root);
  await migrateLegacyJsonlStore(root, runtime, 'evidence', 'receipts.jsonl');
  evidenceDir ||= path.join(runtime, 'evidence');
  receiptsFile ||= path.join(evidenceDir, 'receipts.jsonl');
  await mkdir(evidenceDir, { recursive: true });
  try { await writeFile(path.join(evidenceDir, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  try { await readFile(receiptsFile, 'utf8'); } catch { await writeFile(receiptsFile, ''); }
}

async function receipts() {
  await init();
  const content = await readFile(receiptsFile, 'utf8');
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function testDiscovery(options, passed, failed) {
  if (options['test-discovery']) {
    const value = String(options['test-discovery']);
    if (!['not_reached', 'zero_discovered', 'tests_executed', 'unknown'].includes(value)) {
      throw new Error('--test-discovery must be not_reached, zero_discovered, tests_executed, or unknown');
    }
    return value;
  }
  if (passed !== null || failed !== null) {
    if ((passed ?? 0) + (failed ?? 0) === 0) return 'zero_discovered';
    return 'tests_executed';
  }
  return 'unknown';
}

async function buildReceipt({ startedAt = new Date().toISOString(), endedAt = new Date().toISOString(), exitCode }) {
  const state = await captureGitState(root);
  const passed = integerOption(options, 'tests-passed', null);
  const failed = integerOption(options, 'tests-failed', null);
  const skipped = integerOption(options, 'tests-skipped', null);
  const command = required(options, 'command');
  const discovery = testDiscovery(options, passed, failed);
  const harness = options.harness ? String(options.harness) : null;
  const explicitBehavior = options['behavioral-evidence'];
  const behavioralEvidence = explicitBehavior === undefined
    ? exitCode === 0 && discovery === 'tests_executed'
    : ['true', '1', 'yes'].includes(String(explicitBehavior).toLowerCase());
  const receipt = {
    schema_version: 1,
    id: randomUUID(),
    kind: required(options, 'kind'),
    scope: String(options.scope || 'focused'),
    command,
    cwd: path.relative(root, process.cwd()) || '.',
    git_head: state.head,
    git_tree: state.tree,
    working_tree_hash: state.working_tree_hash,
    started_at: startedAt,
    ended_at: endedAt,
    exit_code: exitCode,
    source: String(options.source || 'manual-record'),
    final_gate: options.final === true,
    harness,
    capabilities: harness ? await harnessCapabilities(harness) : null,
    behavioral_evidence: behavioralEvidence,
    invalidation_reason: null,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
      npm: process.env.npm_config_user_agent || null,
      host_version: options['host-version'] ? String(options['host-version']) : null
    },
    tests: {
      discovery,
      discovered: integerOption(options, 'tests-discovered', [passed, failed, skipped].some((value) => value !== null) ? (passed ?? 0) + (failed ?? 0) + (skipped ?? 0) : null),
      passed,
      failed,
      skipped
    },
    dependency_cone: options.dependencies ? String(options.dependencies).split(',').map((value) => value.trim()).filter(Boolean) : [],
    inputs: options.inputs ? String(options.inputs).split(',').map((value) => value.trim()).filter(Boolean) : [],
    notes: options.notes ? String(options.notes) : null
  };
  validateReceipt(receipt);
  return receipt;
}

function validateReceipt(receipt) {
  const { discovery, discovered, passed, failed, skipped } = receipt.tests;
  for (const [name, value] of Object.entries({ discovered, passed, failed, skipped })) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`test metadata ${name} must be a non-negative integer or null`);
    }
  }
  const counts = [passed, failed, skipped];
  const hasCounts = counts.some((value) => value !== null);
  const total = hasCounts ? (passed ?? 0) + (failed ?? 0) + (skipped ?? 0) : null;
  if (discovered !== null && total !== null && discovered !== total) {
    throw new Error(`contradictory test metadata: discovered ${discovered} does not equal count total ${total}`);
  }
  if (discovery === 'tests_executed' && (!Number.isInteger(discovered) || discovered <= 0)) {
    throw new Error('contradictory test metadata: tests_executed requires discovered > 0');
  }
  if (discovery === 'zero_discovered' && (discovered !== 0 || total !== 0)) {
    throw new Error('contradictory test metadata: zero_discovered requires every test count to be zero');
  }
  if (discovery === 'not_reached' && (discovered !== null || hasCounts)) {
    throw new Error('contradictory test metadata: not_reached cannot include test counts');
  }
  if (discovery === 'unknown' && (discovered !== null || hasCounts)) {
    throw new Error('contradictory test metadata: unknown discovery cannot include test counts');
  }
  if (receipt.behavioral_evidence && (
    discovery !== 'tests_executed'
    || (receipt.exit_code !== 0 && receipt.kind !== 'red')
  )) {
    throw new Error('behavioral evidence requires executed tests and a successful command (except explicit red evidence)');
  }
}

async function store(receipt) {
  await init();
  await appendFile(receiptsFile, `${JSON.stringify(receipt)}\n`);
  console.log(JSON.stringify(receipt));
}

async function findReusable(command, kind, scope) {
  const allReceipts = await receipts();
  const state = await captureGitState(root);
  const candidates = allReceipts.filter((receipt) =>
    receipt.command === command && receipt.kind === kind && receipt.scope === scope &&
    receipt.exit_code === 0 && receipt.working_tree_hash === state.working_tree_hash
  );
  return candidates.at(-1) || null;
}

async function main() {
  const receiptsDisabled = options['no-receipt'] === true
    || ['0', 'off', 'false', 'disabled'].includes(String(process.env.ZIMSTER_RECEIPTS || '').toLowerCase());
  if (receiptsDisabled) {
    if (commandName === 'run') {
      if (!passthrough.length) throw new Error('evidence run requires a command after --');
      const result = spawnSync(passthrough.join(' '), { cwd: process.cwd(), shell: true, stdio: 'inherit' });
      console.log('RECEIPTS_DISABLED');
      process.exitCode = result.status ?? 1;
      return;
    }
    console.log('RECEIPTS_DISABLED');
    return;
  }
  if (commandName === 'init') {
    await init();
    console.log(evidenceDir);
    return;
  }
  if (commandName === 'record') {
    await init();
    const exitCode = integerOption(options, 'exit-code');
    if (exitCode === undefined) throw new Error('--exit-code is required');
    await store(await buildReceipt({ exitCode }));
    return;
  }
  if (commandName === 'check') {
    await init();
    const id = required(options, 'id');
    const receipt = (await receipts()).find((item) => item.id === id);
    if (!receipt) throw new Error(`evidence receipt not found: ${id}`);
    const state = await captureGitState(root);
    if (state.working_tree_hash === receipt.working_tree_hash) {
      console.log(`VALID ${id}`);
      return;
    }
    console.log(`STALE ${id}`);
    process.exitCode = 2;
    return;
  }
  if (commandName === 'find') {
    await init();
    const command = required(options, 'command');
    const kind = required(options, 'kind');
    const scope = String(options.scope || 'focused');
    const receipt = await findReusable(command, kind, scope);
    if (!receipt) {
      console.log('NO_REUSABLE_EVIDENCE');
      process.exitCode = 1;
      return;
    }
    console.log(`REUSABLE_DUPLICATE ${JSON.stringify(receipt)}`);
    return;
  }
  if (commandName === 'list') {
    for (const receipt of await receipts()) console.log(JSON.stringify(receipt));
    return;
  }
  if (commandName === 'run') {
    await init();
    if (!passthrough.length) throw new Error('evidence run requires a command after --');
    const command = passthrough.join(' ');
    options.command = command;
    options.kind = options.kind || 'command';
    options.scope = options.scope || 'focused';
    const duplicate = await findReusable(command, String(options.kind), String(options.scope));
    if (duplicate && options.force !== true) {
      console.error(`Valid duplicate evidence exists: ${duplicate.id}. Pass --force to rerun; final gates must always rerun.`);
      if (options.reuse === true && options.final !== true) {
        console.log(`REUSED ${JSON.stringify(duplicate)}`);
        return;
      }
    }
    const startedAt = new Date().toISOString();
    const result = spawnSync(command, { cwd: process.cwd(), shell: true, stdio: 'inherit' });
    const endedAt = new Date().toISOString();
    const exitCode = result.status ?? 1;
    await store(await buildReceipt({ startedAt, endedAt, exitCode }));
    process.exitCode = exitCode;
    return;
  }
  throw new Error('Usage: evidence.mjs <init|record|check|find|list|run> [options]');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
