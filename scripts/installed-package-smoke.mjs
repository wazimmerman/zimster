import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, writeLine } from './lib/cli.mjs';
import { archivePathProblem, readStoredZip } from './lib/zip-reader.mjs';
import { readTarGzip } from './lib/tar-reader.mjs';

const { options } = parseOptions(process.argv.slice(2));
const dist = path.resolve(process.cwd(), String(options.dist || 'dist'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-installed-package-'));
const targets = [];

async function extract(archive, destination) {
  for (const entry of await readStoredZip(archive)) {
    const problem = archivePathProblem(entry.name);
    if (problem) throw new Error(`${entry.name}: ${problem}`);
    const target = path.join(destination, ...entry.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
}

function isolatedEnvironment(home, additions = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    CODEX_HOME: path.join(home, 'codex'),
    ...additions
  };
}

function execute(file, args, cwd, env) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0 || String(result.stderr || '').trim()) {
    throw new Error(
      String(result.stderr || result.stdout || `command exited ${result.status}`).trim()
    );
  }
  return String(result.stdout || '').trim();
}

function executeResult(file, args, cwd, env) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024
  });
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return String(result.stdout || '').trim();
}

function parseJson(label, value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}; output=${JSON.stringify(value)}`);
  }
}

async function exercisePackagedWorkflow(runtimeRoot, fixture, home) {
  await mkdir(fixture, { recursive: true });
  git(['init', '-q', '-b', 'main'], fixture);
  git(['config', 'user.name', 'Zimster Package Smoke'], fixture);
  git(['config', 'user.email', 'smoke@example.invalid'], fixture);
  await writeFile(path.join(fixture, 'fixture.txt'), 'packaged helper workflow\n');
  git(['add', 'fixture.txt'], fixture);
  git(['commit', '-qm', 'fixture'], fixture);
  const env = isolatedEnvironment(home);
  execute(
    path.join(runtimeRoot, 'scripts', 'init-run.mjs'),
    [
      '--profile', 'high-risk', '--harness', 'codex',
      '--next-slice-id', 'slice-1', '--next-slice-title', 'Packaged control path',
      '--next-action', 'Start the packaged slice',
      '--next-command', 'node scripts/run-control.mjs start'
    ],
    fixture,
    env
  );
  const runtime = git(['rev-parse', '--path-format=absolute', '--git-path', 'zimster'], fixture);
  let runSummary = await readFile(path.join(runtime, 'run.md'), 'utf8');
  if (!runSummary.includes('Profile: high-risk') || !runSummary.includes('slice-1')) {
    throw new Error('packaged init-run helper did not initialize canonical High-risk state');
  }
  execute(
    path.join(runtimeRoot, 'scripts', 'run-control.mjs'),
    [
      'start', '--slice-id', 'slice-1', '--slice-title', 'Packaged control path',
      '--next-slice-id', 'slice-2', '--remaining-obligations', '["run packaged verification"]',
      '--next-action', 'Checkpoint dirty package work',
      '--next-command', 'node scripts/run-control.mjs checkpoint'
    ],
    fixture,
    env
  );
  await writeFile(path.join(fixture, 'fixture.txt'), 'packaged helper correction\n');
  await writeFile(path.join(fixture, 'second.txt'), 'dirty uncommitted package work\n');
  const checkpoint = parseJson('packaged checkpoint', execute(
    path.join(runtimeRoot, 'scripts', 'run-control.mjs'),
    [
      'checkpoint', '--status', 'in_progress',
      '--completed-obligations', '["initialize exact package"]',
      '--remaining-obligations', '["run packaged verification"]',
      '--next-action', 'Run governed packaged verification',
      '--next-command', 'node scripts/evidence.mjs run'
    ],
    fixture,
    env
  )).checkpoint;
  if (checkpoint.current_slice?.id !== 'slice-1'
    || checkpoint.repository_state?.touched_files?.length !== 2) {
    throw new Error('packaged dirty checkpoint did not preserve the current slice and touched files');
  }
  const evidence = parseJson('packaged governed evidence', execute(
    path.join(runtimeRoot, 'scripts', 'evidence.mjs'),
    [
      'run', '--kind', 'test', '--scope', 'focused',
      '--test-discovery', 'tests_executed', '--tests-passed', '1', '--',
      process.execPath, '-e', 'process.exit(0)'
    ],
    fixture,
    env
  ));
  if (!evidence.execution_id || evidence.exit_code !== 0) {
    throw new Error('packaged governed evidence did not produce an authenticated execution receipt');
  }
  const resumed = parseJson('packaged resume', execute(
    path.join(runtimeRoot, 'scripts', 'run-control.mjs'),
    ['resume'],
    fixture,
    env
  ));
  if (resumed.current_slice?.id !== 'slice-1'
    || resumed.repository_state?.touched_files?.length !== 2) {
    throw new Error('fresh packaged resume lost dirty current-slice state');
  }
  const accounting = parseJson('packaged accounting reconciliation', execute(
    path.join(runtimeRoot, 'scripts', 'accounting-reconcile.mjs'),
    ['reconcile', '--reason', 'exact-package smoke'],
    fixture,
    env
  ));
  if (!['ACCOUNTING_CURRENT', 'ACCOUNTING_RECONCILED'].includes(accounting.status)
    || accounting.unobserved_direct_shell_commands !== 'not_observable') {
    throw new Error('packaged accounting reconciliation is not auditable');
  }
  execute(path.join(runtimeRoot, 'scripts', 'run-control.mjs'), ['check'], fixture, env);
  await writeFile(path.join(runtime, 'run.md'), '# stale packaged summary\n');
  let checked = executeResult(
    path.join(runtimeRoot, 'scripts', 'run-control.mjs'), ['check'], fixture, env
  );
  if (checked.status !== 2 || !String(checked.stdout).includes('STALE_RUN_SUMMARY')) {
    throw new Error('packaged run summary drift was not detected');
  }
  execute(path.join(runtimeRoot, 'scripts', 'run-control.mjs'), ['refresh'], fixture, env);
  execute(path.join(runtimeRoot, 'scripts', 'run-control.mjs'), ['check'], fixture, env);

  const lifecycleModule = pathToFileURL(path.join(
    runtimeRoot,
    'scripts',
    'lib',
    'review-lifecycle.mjs'
  )).href;
  const lifecycleOutput = path.join(fixture, '.lifecycle-probe.json');
  const lifecycleProbe = `
import { writeFileSync } from 'node:fs';
import { applyReviewLifecycleEvent as apply, createReviewLifecycle as create } from ${JSON.stringify(lifecycleModule)};
const clean = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const candidate = (head = 'b'.repeat(40)) => ({ base_sha: 'a'.repeat(40), head_sha: head, tree_sha: 'c'.repeat(40), dirty_tree_fingerprint: clean, semantic_contract_sha256: 'd'.repeat(64) });
let state = create({ seam_id: 'package-smoke', reviewer_identity: 'reviewer', candidate: candidate() });
const start = (type, id, head = 'b'.repeat(40)) => apply(state, { type: 'attempt_started', attempt: { attempt_type: type, attempt_id: id, seam_id: 'package-smoke', reviewer_identity: 'reviewer', review_package_id: 'package-' + id, candidate: candidate(head) } });
state = start('initial_review', 'initial');
state = apply(state, { type: 'verdict_recorded', attempt_id: 'initial', verdict: 'approved', findings: [] });
state = apply(state, { type: 'candidate_stabilized' });
state = start('final_integration_review', 'final-1');
state = apply(state, { type: 'verdict_recorded', attempt_id: 'final-1', verdict: 'needs_correction', findings: [{ severity: 'Important', summary: 'first' }] });
state = apply(state, { type: 'correction_recorded', candidate: candidate('e'.repeat(40)) });
state = apply(state, { type: 'candidate_stabilized' });
state = start('final_integration_review', 'final-2', 'e'.repeat(40));
state = apply(state, { type: 'verdict_recorded', attempt_id: 'final-2', verdict: 'needs_correction', findings: [{ severity: 'Important', summary: 'second' }] });
if (state.status !== 'strategy_escalation_required') throw new Error('missing durable escalation');
let rejected = false;
try { state = start('final_integration_review', 'final-3', 'e'.repeat(40)); } catch { rejected = true; }
if (!rejected) throw new Error('third final review was admitted');
let selfAssertedRejected = false;
try {
  state = apply(state, {
    type: 'breaker_disposition_recorded',
    disposition: 'reviewer_rebutted_with_evidence',
    reason: 'caller-authored verification claims are not reviewer decisions',
    evidence_refs: [{
      receipt_type: 'verification',
      receipt_id: 'forged',
      execution_id: 'forged',
      authentication: 'governed-execution-v1',
      candidate: candidate('e'.repeat(40)),
      environment: {},
      step_ids: ['trivial'],
      finding_fingerprints: ['f'.repeat(64)]
    }]
  });
} catch { selfAssertedRejected = true; }
if (!selfAssertedRejected) throw new Error('self-asserted review proof was admitted');
writeFileSync(${JSON.stringify(lifecycleOutput)}, JSON.stringify({
  status: state.status,
  self_asserted_review_proof_rejected: selfAssertedRejected
}));
`;
  execute('--input-type=module', ['-e', lifecycleProbe], fixture, env);
  const lifecycle = JSON.parse(await readFile(lifecycleOutput, 'utf8'));
  await rm(lifecycleOutput, { force: true });
  if (lifecycle.status !== 'strategy_escalation_required'
    || lifecycle.self_asserted_review_proof_rejected !== true) {
    throw new Error('packaged hard lifecycle did not enter strategy escalation');
  }

  const semanticModule = pathToFileURL(path.join(
    runtimeRoot, 'scripts', 'lib', 'semantic-assurance.mjs'
  )).href;
  const postmortemModule = pathToFileURL(path.join(
    runtimeRoot, 'scripts', 'lib', 'postmortem-state.mjs'
  )).href;
  const acceptanceProbeRoot = path.join(home, 'acceptance-evidence-probe');
  const acceptanceOutput = path.join(home, 'acceptance-evidence-probe.json');
  const acceptanceProbe = `
import { mkdir, writeFile } from 'node:fs/promises';
import { classifyEvidencePurpose as classify, evaluateTddEvidencePair as tdd } from ${JSON.stringify(semanticModule)};
import { postmortemStateBinding as bind, validatePostmortemState as validate } from ${JSON.stringify(postmortemModule)};
const diagnostic = classify({ status: 'valid', requirement_ids: [], establishes: ['claim'], dependency_cone: [], dependency_fingerprints: [] });
if (diagnostic.purpose !== 'diagnostic') throw new Error('unbound evidence established a claim');
const command = 'a'.repeat(64);
const red = { id: 'red', kind: 'red', exit_code: 1, requirement_ids: ['TDD-001'], environment_scope: 'node', command_identity: command, governed_execution_authenticated: true, tdd_phase: 'red', tdd_behavior_id: 'packaged-behavior', tdd_red_receipt_id: null, ended_at: '2026-08-17T10:01:00.000Z', tests: { discovery: 'tests_executed', failed: 1 } };
const green = { id: 'green', exit_code: 0, environment_scope: 'node', command_identity: command, governed_execution_authenticated: true, tdd_phase: 'green', tdd_behavior_id: 'packaged-behavior', tdd_red_receipt_id: 'red', started_at: '2026-08-17T10:02:00.000Z', tests: { discovery: 'tests_executed', passed: 1 } };
if (tdd({ requirementId: 'TDD-001', behaviorId: 'packaged-behavior', greenEvidence: [green], allEvidence: [red, green] }).status !== 'verified') throw new Error('authentic packaged RED/GREEN pair was rejected');
if (tdd({ requirementId: 'TDD-001', behaviorId: 'packaged-behavior', greenEvidence: [green], allEvidence: [green] }).status !== 'unavailable') throw new Error('missing packaged RED was reconstructed');
const runtime = ${JSON.stringify(acceptanceProbeRoot)};
await mkdir(runtime, { recursive: true });
await writeFile(runtime + '/budget.json', '{"usage":{"complete_suite_executions":1}}\\n');
const report = { source_state: await bind(runtime) };
if (!(await validate(report, runtime)).current) throw new Error('fresh packaged postmortem binding was rejected');
await writeFile(runtime + '/budget.json', '{"usage":{"complete_suite_executions":2}}\\n');
if ((await validate(report, runtime)).current) throw new Error('stale packaged postmortem binding was accepted');
await writeFile(${JSON.stringify(acceptanceOutput)}, JSON.stringify({ diagnostic: true, tdd: true, postmortem_staleness: true }));
`;
  execute('--input-type=module', ['-e', acceptanceProbe], fixture, env);
  const acceptance = JSON.parse(await readFile(acceptanceOutput, 'utf8'));
  await rm(acceptanceOutput, { force: true });
  if (!acceptance.diagnostic || !acceptance.tdd || !acceptance.postmortem_staleness) {
    throw new Error('packaged acceptance evidence probe was incomplete');
  }

  checked = executeResult(
    path.join(runtimeRoot, 'scripts', 'coherence-preflight.mjs'),
    ['check', '--operation', 'completion', '--profile', 'high-risk'],
    fixture,
    env
  );
  if (checked.status !== 2
    || parseJson('packaged completion preflight', checked.stdout).status !== 'COHERENCE_BLOCKED') {
    throw new Error('packaged completion preflight did not fail closed on dirty incomplete state');
  }

  runSummary = await readFile(path.join(runtime, 'run.md'), 'utf8');
  if (runSummary.includes('[Describe the required outcome')
    || !runSummary.includes('slice-1')
    || !runSummary.includes(evidence.id)) {
    throw new Error('packaged run.md retained placeholders or omitted current evidence');
  }
  JSON.parse(execute(
    path.join(runtimeRoot, 'scripts', 'model-routing.mjs'),
    ['validate-config', '--config', path.join(runtimeRoot, 'config', 'model-routing.json')],
    fixture,
    isolatedEnvironment(home)
  ));
}

try {
  const archives = (await readdir(dist))
    .filter((name) => /^zimster-.*-(claude|codex|openai|portable)\.zip$/.test(name))
    .sort();
  for (const target of ['claude', 'codex', 'openai', 'portable']) {
    const name = archives.find((candidate) => candidate.endsWith(`-${target}.zip`));
    if (!name) throw new Error(`missing exact ${target} candidate archive`);
    const archive = path.join(dist, name);
    const extracted = path.join(temporary, target, 'package');
    const home = path.join(temporary, target, 'home');
    await mkdir(home, { recursive: true });
    await extract(archive, extracted);
    if (target === 'claude') {
      const output = execute(
        path.join(extracted, 'hooks', 'session-start.mjs'),
        [],
        extracted,
        isolatedEnvironment(home, {
          CLAUDE_PLUGIN_ROOT: extracted
        })
      );
      const payload = JSON.parse(output);
      if (!payload.hookSpecificOutput?.additionalContext?.includes('# Using Zimster')) {
        throw new Error('Claude installed hook did not load using-zimster');
      }
    }
    const packageRoot = target === 'codex'
      ? path.join(extracted, 'plugins', 'zimster')
      : extracted;
    if (target === 'claude' || target === 'codex') {
      JSON.parse(execute(
        path.join(packageRoot, 'scripts', 'model-routing.mjs'),
        ['validate-config', '--config', path.join(packageRoot, 'templates', 'zimster-config.json')],
        packageRoot,
        isolatedEnvironment(home)
      ));
      for (const contract of [
        'schemas/delegation-decision.schema.json',
        'schemas/model-proposal.schema.json',
        'schemas/routing-observation.schema.json',
        'schemas/convergence-decision.schema.json',
        'schemas/host-smoke-receipt.schema.json',
        'docs/INSTALL.md',
        'docs/CONFIGURATION.md',
        'docs/MIGRATING-0.5.0.md'
      ]) await readFile(path.join(packageRoot, contract));
    }
    if (target === 'codex') {
      JSON.parse(execute(
        path.join(packageRoot, 'scripts', 'doctor.mjs'),
        ['--json'],
        packageRoot,
        isolatedEnvironment(home)
      ));
    }
    if (target === 'claude' || target === 'codex' || target === 'openai' || target === 'portable') {
      const runtimeRoot = target === 'codex'
        ? packageRoot
        : (target === 'claude' ? packageRoot : path.join(packageRoot, 'skills', 'using-zimster'));
      await exercisePackagedWorkflow(
        runtimeRoot,
        path.join(temporary, target, 'workflow-fixture'),
        home
      );
    }
    if (target === 'openai' || target === 'portable') {
      await readFile(path.join(packageRoot, target === 'openai' ? '.codex-plugin/plugin.json' : 'plugin.json'));
      await readFile(path.join(packageRoot, 'skills', 'using-zimster', 'SKILL.md'));
      const metadata = JSON.parse(await readFile(
        path.join(packageRoot, 'skills', 'using-zimster', 'references', 'build-metadata.json'),
        'utf8'
      ));
      if (metadata.package_target !== target) {
        throw new Error(`${target} build metadata does not identify the exact candidate`);
      }
    }
    const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
    targets.push({ target, status: 'passed', archive: name, sha256: hash });
  }
  const npmName = (await readdir(dist)).find((name) => /^zimster-.*\.tgz$/.test(name));
  if (!npmName) throw new Error('missing exact npm candidate archive');
  const npmArchive = path.join(dist, npmName);
  const npmEntries = await readTarGzip(npmArchive);
  const npmNames = new Set(npmEntries.map(({ name }) => name));
  for (const required of ['package/package.json', 'package/plugin.json', 'package/skills/using-zimster/SKILL.md']) {
    if (!npmNames.has(required)) throw new Error(`npm candidate is missing ${required}`);
  }
  if ([...npmNames].some((name) => name.startsWith('package/plugins/zimster/'))) {
    throw new Error('npm candidate contains the generated Codex mirror');
  }
  const npmExtracted = path.join(temporary, 'npm', 'package');
  const npmHome = path.join(temporary, 'npm', 'home');
  await mkdir(npmHome, { recursive: true });
  for (const entry of npmEntries) {
    if (!entry.name.startsWith('package/') || entry.name.endsWith('/')) continue;
    const relative = entry.name.slice('package/'.length);
    const target = path.join(npmExtracted, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  await exercisePackagedWorkflow(
    npmExtracted,
    path.join(temporary, 'npm', 'workflow-fixture'),
    npmHome
  );
  targets.push({
    target: 'npm', status: 'passed', archive: npmName,
    sha256: createHash('sha256').update(await readFile(npmArchive)).digest('hex')
  });
  writeLine(JSON.stringify({ schema_version: 1, status: 'passed', targets }));
} catch (error) {
  writeLine(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    targets,
    action: error.message
  }));
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
