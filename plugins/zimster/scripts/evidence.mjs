import {
  appendFile,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, required, integerOption } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { canonicalPath, repositoryRelativeIdentity, reviewFileIdentity } from './lib/path-identity.mjs';
import {
  evidenceStalenessReason,
  fingerprintJson,
  fingerprintPathIdentities
} from './lib/evidence-validity.mjs';
import { ensureRuntimeDirectory, migrateLegacyJsonlStore } from './lib/runtime.mjs';
import { harnessCapabilities } from './lib/capabilities.mjs';
import { beginGovernedExecution, finishGovernedExecution } from './lib/governed-execution.mjs';
import {
  evidenceCheckpointChanges,
  withControlPlaneMutation
} from './lib/control-plane-mutation.mjs';

const { positional, options, passthrough } = parseOptions(process.argv.slice(2));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commandName = positional[0];
const root = await canonicalPath(findRepoRoot(process.cwd()));
const workingDirectory = await canonicalPath(process.cwd());
const cwdIdentity = await repositoryRelativeIdentity(root, workingDirectory);
let evidenceDir;
let receiptsFile;

function writeLine(value, stream = process.stdout) {
  writeSync(stream.fd, `${value}\n`);
}

function listOption(name) {
  if (!options[name]) return [];
  const value = String(options[name]).trim();
  if (value.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`--${name} must be a comma-separated list or JSON array of strings`);
    }
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) {
      throw new Error(`--${name} must be a comma-separated list or JSON array of strings`);
    }
    return parsed;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function npmVersion() {
  const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

function environment(hostVersion = null) {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    npm: npmVersion(),
    host_version: hostVersion
  };
}

async function canonicalInputIdentities(inputs, base) {
  return Promise.all(inputs.map((input) => reviewFileIdentity(root, input, { base })));
}

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
  return (await ledger()).filter((row) => row.record_type !== 'invalidation');
}

async function ledger() {
  await init();
  const content = await readFile(receiptsFile, 'utf8');
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function commandArgvOption() {
  if (options['command-argv'] === undefined) return null;
  let value;
  try {
    value = JSON.parse(String(options['command-argv']));
  } catch {
    throw new Error('--command-argv must be a JSON array of strings');
  }
  if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === 'string')) {
    throw new Error('--command-argv must be a non-empty JSON array of strings');
  }
  return value;
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
  const cwd = cwdIdentity;
  const commandArgv = commandArgvOption();
  const discovery = testDiscovery(options, passed, failed);
  const harness = options.harness ? String(options.harness) : null;
  const explicitBehavior = options['behavioral-evidence'];
  const inputs = await canonicalInputIdentities(listOption('inputs'), workingDirectory);
  const behavioralEvidence = explicitBehavior === undefined
    ? exitCode === 0 && discovery === 'tests_executed'
    : ['true', '1', 'yes'].includes(String(explicitBehavior).toLowerCase());
  const recordedEnvironment = environment(options['host-version'] ? String(options['host-version']) : null);
  const dependencies = await canonicalInputIdentities(listOption('dependencies'), root);
  const requirementIds = listOption('requirement-ids');
  for (const id of requirementIds) {
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]{3,}$/.test(id)) {
      throw new Error(`malformed requirement ID: ${id}`);
    }
  }
  const receipt = {
    schema_version: 2,
    path_identity_format: 'canonical-v1',
    id: randomUUID(),
    kind: required(options, 'kind'),
    scope: String(options.scope || 'focused'),
    command,
    command_argv: commandArgv,
    command_identity: fingerprintJson({
      cwd,
      argv: commandArgv,
      command: commandArgv ? null : command
    }),
    cwd,
    git_head: state.head,
    git_commit: state.head,
    git_tree: state.tree,
    working_tree_hash: state.working_tree_hash,
    dirty_tree_fingerprint: state.dirty_tree_fingerprint,
    started_at: startedAt,
    ended_at: endedAt,
    exit_code: exitCode,
    source: String(options.source || 'manual-record'),
    final_gate: options.final === true,
    harness,
    capabilities: harness ? await harnessCapabilities(harness) : null,
    behavioral_evidence: behavioralEvidence,
    invalidation_reason: options['invalidation-reason']
      ? String(options['invalidation-reason'])
      : null,
    environment: recordedEnvironment,
    environment_fingerprint: fingerprintJson(recordedEnvironment),
    tests: {
      discovery,
      discovered: integerOption(options, 'tests-discovered', [passed, failed, skipped].some((value) => value !== null) ? (passed ?? 0) + (failed ?? 0) + (skipped ?? 0) : null),
      passed,
      failed,
      skipped
    },
    dependency_cone: dependencies,
    dependency_fingerprints: await fingerprintPathIdentities(root, dependencies),
    inputs,
    input_fingerprints: await fingerprintPathIdentities(root, inputs),
    requirement_ids: requirementIds,
    establishes: listOption('establishes'),
    does_not_establish: listOption('does-not-establish'),
    environment_scope: options['environment-scope']
      ? String(options['environment-scope'])
      : null,
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
  const bytes = `${JSON.stringify(receipt)}\n`;
  await appendFile(receiptsFile, bytes);
  return bytes;
}

async function findReusable(command, kind, scope) {
  if (options.final === true) return null;
  const requestedCwd = cwdIdentity;
  const requestedArgv = commandArgvOption();
  const requestedDependencies = await canonicalInputIdentities(listOption('dependencies'), root);
  const requestedInputs = await canonicalInputIdentities(listOption('inputs'), workingDirectory);
  const allReceipts = await receipts();
  const invalidated = new Set(
    (await ledger())
      .filter((row) => row.record_type === 'invalidation')
      .map((row) => row.receipt_id)
  );
  const candidates = allReceipts.filter((receipt) =>
    receipt.command === command && receipt.kind === kind && receipt.scope === scope &&
    receipt.cwd === requestedCwd &&
    (requestedArgv === null
      ? receipt.command_argv === null || receipt.command_argv === undefined
      : sameList(receipt.command_argv, requestedArgv)) &&
    receipt.exit_code === 0 && !receipt.invalidation_reason && !invalidated.has(receipt.id)
  );
  for (const receipt of candidates.reverse()) {
    if (!(await invalidationReason(receipt, {
      dependencies: requestedDependencies,
      inputs: requestedInputs
    }))) return receipt;
  }
  return null;
}

function sameList(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

async function invalidationReason(receipt, requested = {}) {
  const state = await captureGitState(root);
  return evidenceStalenessReason(receipt, {
    root,
    state,
    environment: environment(options['host-version'] ? String(options['host-version']) : null),
    requested
  });
}

async function main() {
  const receiptsDisabled = options['no-receipt'] === true
    || ['0', 'off', 'false', 'disabled'].includes(String(process.env.ZIMSTER_RECEIPTS || '').toLowerCase());
  if (receiptsDisabled) {
    if (commandName === 'run') {
      if (!passthrough.length) throw new Error('evidence run requires a command after --');
      const result = spawnSync(passthrough[0], passthrough.slice(1), {
        cwd: workingDirectory,
        shell: false,
        stdio: 'inherit'
      });
      writeLine('RECEIPTS_DISABLED');
      process.exitCode = result.status ?? 1;
      return;
    }
    writeLine('RECEIPTS_DISABLED');
    return;
  }
  if (commandName === 'init') {
    await init();
    writeLine(evidenceDir);
    return;
  }
  if (commandName === 'record') {
    await init();
    const exitCode = integerOption(options, 'exit-code');
    if (exitCode === undefined) throw new Error('--exit-code is required');
    const receipt = await buildReceipt({ exitCode });
    const runtime = await ensureRuntimeDirectory(root);
    const bytes = await withControlPlaneMutation(runtime, root, {
      mutationType: 'evidence_recorded',
      checkpointChanges: () => evidenceCheckpointChanges(runtime, {
        id: receipt.id,
        status: exitCode === 0 ? 'valid' : 'stale',
        ...(exitCode === 0 ? {} : { invalidation_reason: 'recorded evidence did not pass' })
      })
    }, () => store(receipt));
    writeSync(process.stdout.fd, bytes);
    return;
  }
  if (commandName === 'check') {
    await init();
    const id = required(options, 'id');
    const receipt = (await receipts()).find((item) => item.id === id);
    if (!receipt) throw new Error(`evidence receipt not found: ${id}`);
    const explicitInvalidation = (await ledger()).find(
      (item) => item.record_type === 'invalidation' && item.receipt_id === id
    );
    if (explicitInvalidation) {
      writeLine(`STALE ${id} ${explicitInvalidation.reason}`);
      process.exitCode = 2;
      return;
    }
    const reason = await invalidationReason(receipt);
    if (!reason) {
      writeLine(`VALID ${id}`);
      return;
    }
    writeLine(`STALE ${id} ${reason}`);
    process.exitCode = 2;
    return;
  }
  if (commandName === 'invalidate') {
    await init();
    const id = required(options, 'id');
    const reason = required(options, 'reason');
    const receipt = (await receipts()).find((item) => item.id === id);
    if (!receipt) throw new Error(`evidence receipt not found: ${id}`);
    const invalidation = {
      schema_version: 1,
      record_type: 'invalidation',
      id: randomUUID(),
      receipt_id: id,
      reason,
      invalidated_at: new Date().toISOString()
    };
    const runtime = await ensureRuntimeDirectory(root);
    await withControlPlaneMutation(runtime, root, {
      mutationType: 'evidence_invalidated',
      checkpointChanges: () => evidenceCheckpointChanges(runtime, {
        id,
        status: 'stale',
        invalidation_reason: reason
      })
    }, () => appendFile(receiptsFile, `${JSON.stringify(invalidation)}\n`));
    writeSync(process.stdout.fd, `${JSON.stringify(invalidation)}\n`);
    return;
  }
  if (commandName === 'find') {
    await init();
    const command = required(options, 'command');
    const kind = required(options, 'kind');
    const scope = String(options.scope || 'focused');
    const receipt = await findReusable(command, kind, scope);
    if (!receipt) {
      writeLine('NO_REUSABLE_EVIDENCE');
      process.exitCode = 1;
      return;
    }
    writeLine(`REUSABLE_DUPLICATE ${JSON.stringify(receipt)}`);
    return;
  }
  if (commandName === 'list') {
    for (const receipt of await receipts()) writeLine(JSON.stringify(receipt));
    return;
  }
  if (commandName === 'run') {
    await init();
    if (!passthrough.length) throw new Error('evidence run requires a command after --');
    const command = passthrough.join(' ');
    options.command = command;
    options['command-argv'] = JSON.stringify(passthrough);
    options.kind = options.kind || 'command';
    options.scope = options.scope || 'focused';
    const duplicate = await findReusable(command, String(options.kind), String(options.scope));
    if (duplicate && options.force !== true) {
      writeLine(
        `Valid duplicate evidence exists: ${duplicate.id}. Pass --force to rerun; final gates must always rerun.`,
        process.stderr
      );
      if (options.reuse === true && options.final !== true) {
        writeLine(`REUSED ${JSON.stringify(duplicate)}`);
        return;
      }
      writeLine(`REUSABLE_DUPLICATE ${duplicate.id}`);
      process.exitCode = 2;
      return;
    }
    const runtime = await ensureRuntimeDirectory(root);
    const governed = await withControlPlaneMutation(runtime, root, {
      mutationType: 'governed_evidence_started',
      didMutate: (value) => value.admitted === true
    }, () => beginGovernedExecution(runtime, root, {
      sourceRoot: packageRoot,
      issuer: 'zimster.evidence',
      commandArgv: passthrough,
      cwd: workingDirectory,
      context: { type: 'evidence', kind: String(options.kind), scope: String(options.scope) },
      completeSuite: false,
      budgetOverride: {
        invalidation: options['invalidation-reason']
          ? String(options['invalidation-reason'])
          : null,
        strategyChange: options['strategy-change']
          ? String(options['strategy-change'])
          : null,
        requiredProof: options['required-proof']
          ? String(options['required-proof'])
          : null,
        requiredProofType: options['required-proof-type']
          ? String(options['required-proof-type'])
          : null,
        requiredProofKind: options['required-proof-kind']
          ? String(options['required-proof-kind'])
          : null,
        requiredProofScope: options['required-proof-scope']
          ? String(options['required-proof-scope'])
          : null,
        requiredProofProfile: options['required-proof-profile']
          ? String(options['required-proof-profile'])
          : null,
        requiredProofCommand: options['required-proof-command']
          ? String(options['required-proof-command'])
          : null
      }
    }));
    if (!governed.admitted) {
      writeLine(JSON.stringify(governed.budget));
      const error = new Error(governed.budget.status);
      error.code = 'BUDGET_CONSTRAINED';
      throw error;
    }
    const startedAt = new Date().toISOString();
    const result = spawnSync(passthrough[0], passthrough.slice(1), {
      cwd: workingDirectory,
      shell: false,
      stdio: 'inherit'
    });
    const endedAt = new Date().toISOString();
    const exitCode = result.status ?? 1;
    const receipt = await buildReceipt({ startedAt, endedAt, exitCode });
    receipt.issuer = 'zimster.evidence';
    receipt.execution_id = governed.receipt.id;
    const receiptBytes = await withControlPlaneMutation(runtime, root, {
      mutationType: 'governed_evidence_finished',
      checkpointChanges: () => evidenceCheckpointChanges(runtime, {
        id: receipt.id,
        status: exitCode === 0 ? 'valid' : 'stale',
        ...(exitCode === 0 ? {} : { invalidation_reason: 'governed evidence command failed' })
      })
    }, async () => {
      const bytes = await store(receipt);
      await finishGovernedExecution(runtime, root, {
        executionId: governed.receipt.id,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        terminalReceiptType: 'evidence',
        terminalReceiptId: receipt.id,
        terminalReceiptBytes: bytes,
        compactResult: {
          kind: receipt.kind,
          scope: receipt.scope,
          tests: receipt.tests,
          behavioral_evidence: receipt.behavioral_evidence
        }
      });
      return bytes;
    });
    writeSync(process.stdout.fd, receiptBytes);
    process.exitCode = exitCode;
    return;
  }
  throw new Error('Usage: evidence.mjs <init|record|check|find|invalidate|list|run> [options]');
}

main().catch((error) => {
  writeLine(error.message, process.stderr);
  process.exitCode = error.code === 'BUDGET_CONSTRAINED' ? 2 : 1;
});
