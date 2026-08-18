import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLine } from './lib/cli.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (name) => path.join(packageRoot, 'scripts', name);
const repo = await mkdtemp(path.join(os.tmpdir(), 'zimster-economy-fixture-'));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result;
}

try {
  run('git', ['init', '-b', 'main']);
  run('git', ['config', 'user.name', 'Zimster Fixture']);
  run('git', ['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(path.join(repo, 'tracked.txt'), 'fixture\n');
  run('git', ['add', 'tracked.txt']);
  run('git', ['commit', '-m', 'fixture']);
  run(process.execPath, [script('init-run.mjs'), '--profile', 'standard']);

  const evidenceArgs = [
    script('evidence.mjs'), 'run',
    '--kind', 'command', '--scope', 'focused', '--',
    process.execPath, '-e', 'process.exit(0);'
  ];
  const firstEvidence = run(process.execPath, evidenceArgs);
  const receipt = JSON.parse(firstEvidence.stdout.trim().split('\n').at(-1));
  const reused = run(process.execPath, [
    script('evidence.mjs'), 'run',
    '--kind', 'command', '--scope', 'focused', '--reuse', '--',
    process.execPath, '-e', 'process.exit(0);'
  ]);
  if (!reused.stdout.startsWith('REUSED ')) {
    throw new Error('duplicate command was not reused');
  }

  const budget = JSON.parse(run(process.execPath, [
    script('run-budget.mjs'), 'record',
    '--metric', 'complete_suite_executions', '--amount', '3'
  ]).stdout);

  const runtime = run('git', [
    'rev-parse', '--path-format=absolute', '--git-path', 'zimster'
  ]).stdout.trim();
  await mkdir(runtime, { recursive: true });
  const checkpointInput = path.join(runtime, 'fixture-checkpoint-input.json');
  await writeFile(checkpointInput, `${JSON.stringify({
    mission_digest: 'Demonstrate execution-economy controls without a live goal.',
    invariants_and_non_goals: ['No external services'],
    current_architecture: ['Temporary Git fixture'],
    completed_slice_commits: [run('git', ['rev-parse', 'HEAD']).stdout.trim()],
    evidence_receipts: [{ id: receipt.id, status: 'valid' }],
    open_findings: [],
    unavailable_evidence: [],
    exact_next_slice: 'Resume from the compact checkpoint',
    relevant_files_and_interfaces: ['tracked.txt'],
    budget_position: { complete_suite_executions: 3 }
  }, null, 2)}\n`);
  run(process.execPath, [
    script('phase-checkpoint.mjs'), 'create', '--input', checkpointInput,
    '--max-bytes', '4096'
  ]);
  const resumed = JSON.parse(run(process.execPath, [
    script('phase-checkpoint.mjs'), 'resume'
  ]).stdout);

  const plan = path.join(runtime, 'fixture-verification-plan.json');
  await writeFile(plan, `${JSON.stringify({
    schema_version: 1,
    profile: 'execution-economy-fixture',
    steps: [{
      id: 'fixture-check',
      command: process.execPath,
      args: ['-e', 'process.exit(0);']
    }]
  }, null, 2)}\n`);
  const verificationOutput = run(process.execPath, [
    script('verify.mjs'), 'run', '--plan', plan
  ]).stdout;
  const verification = JSON.parse(verificationOutput);

  writeLine(JSON.stringify({
    schema_version: 1,
    status: 'passed',
    command_deduplication: 'reused_without_execution',
    budget_response: budget.status,
    checkpoint_resumption: resumed.exact_next_slice === 'Resume from the compact checkpoint'
      ? 'passed'
      : 'failed',
    verification: {
      status: verification.status,
      summary_bytes: Buffer.byteLength(verificationOutput)
    }
  }));
} finally {
  await rm(repo, { recursive: true, force: true });
}
