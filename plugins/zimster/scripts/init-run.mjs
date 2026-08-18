import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { integerOption, parseOptions, required, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue } from './lib/git-state.mjs';
import { ensureRuntimeDirectory, resolveAuditPath } from './lib/runtime.mjs';
import { harnessCapabilities } from './lib/capabilities.mjs';
import { initializeExecutionBudget } from './lib/execution-budget.mjs';
import { validateConvergenceConfig } from './lib/convergence.mjs';
import { initializeRunState } from './lib/run-state.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { options } = parseOptions(process.argv.slice(2));
const repo = findRepoRoot(process.cwd());
const auditPath = options['audit-path'] ? String(options['audit-path']) : null;
const runtimeDirectory = auditPath ? null : await ensureRuntimeDirectory(repo);
const target = auditPath
  ? resolveAuditPath(repo, auditPath)
  : path.join(runtimeDirectory, 'run.md');
const profile = String(options.profile || 'standard').toLowerCase();
if (!['micro', 'standard', 'high-risk', 'high_risk', 'high'].includes(profile)) throw new Error('--profile must be micro, standard, or high-risk');
const normalizedProfile = profile === 'micro' ? 'Micro' : profile === 'standard' ? 'Standard' : 'High risk';
const reason = String(options.reason || 'Profile selected from the Zimster risk table.');
const triggers = String(options.triggers || options.trigger || 'manual initialization').split(',').map((value) => value.trim()).filter(Boolean);
const commitPolicy = String(options['commit-policy'] || 'Record user/repository policy before implementation.');
const branch = gitValue(['branch', '--show-current'], repo, 'DETACHED');
const head = gitValue(['rev-parse', 'HEAD'], repo, 'UNBORN');
const harness = options.harness ? String(options.harness).toLowerCase() : null;
const capabilityReceipt = {
  schema_version: 1,
  harness,
  capabilities: harness ? await harnessCapabilities(harness) : null
};
const capabilitySection = `## Harness capability receipt\n\n\`\`\`json\n${JSON.stringify(capabilityReceipt, null, 2)}\n\`\`\``;
const selfHostingCandidate = options['self-hosting-candidate']
  ? String(options['self-hosting-candidate'])
  : null;
let acceptedPolicy = null;
let convergenceConfig;
if (selfHostingCandidate) {
  if (options['convergence-config']) {
    throw new Error('self-hosting candidates cannot use candidate-tree --convergence-config; provide an external accepted-policy artifact');
  }
  const acceptedPath = await realpath(path.resolve(
    process.cwd(),
    required(options, 'accepted-policy-config')
  ));
  const relative = path.relative(repo, acceptedPath);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('self-hosting accepted-policy config must be outside the candidate repository');
  }
  const bytes = await readFile(acceptedPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = required(options, 'accepted-policy-sha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected) || sha256 !== expected) {
    throw new Error('self-hosting accepted-policy digest does not match the immutable expected SHA-256');
  }
  convergenceConfig = validateConvergenceConfig(JSON.parse(bytes.toString('utf8')));
  acceptedPolicy = { path: acceptedPath, sha256 };
} else {
  const convergenceConfigPath = options['convergence-config']
    ? path.resolve(repo, String(options['convergence-config']))
    : path.join(scriptRoot, 'config', 'convergence.json');
  convergenceConfig = validateConvergenceConfig(JSON.parse(await readFile(convergenceConfigPath, 'utf8')));
}

function withCapabilityReceipt(contents) {
  const existing = /## Harness capability receipt\n\n```json\n[\s\S]*?\n```/;
  if (existing.test(contents)) return contents.replace(existing, capabilitySection);
  const architecture = '## Architecture and current slice';
  if (contents.includes(architecture)) {
    return contents.replace(architecture, `${capabilitySection}\n\n${architecture}`);
  }
  return `${contents.trimEnd()}\n\n${capabilitySection}\n`;
}

let template = await readFile(path.join(scriptRoot, 'templates', 'run.md'), 'utf8');
template = template
  .replace('## Mission and constraints', '## Mission and constraints\n\n[Describe the required outcome and binding constraints.]')
  .replace('## Architecture and current slice', `## Profile and rationale\n\n- Profile: ${normalizedProfile}\n- Rationale: ${reason}\n- Durable-state triggers: ${triggers.join('; ')}\n\n## Architecture and current slice`)
  .replace('## Completed evidence', `## Git disposition\n\n- Branch: ${branch || 'DETACHED'}\n- Starting head: ${head}\n- Commit policy: ${commitPolicy}\n\n## Dispatch records\n\n[Reference Git-local zimster/dispatches IDs; include requested/effective model or unverified.]\n\n## Completed evidence`);
template = withCapabilityReceipt(template);

await mkdir(path.dirname(target), { recursive: true });
const legacy = path.join(repo, '.zimster', 'run.md');
if (!auditPath && options.force !== true) {
  try {
    await access(legacy);
    try {
      await access(target);
      throw new Error(`legacy and Git-local run records both exist; reconcile ${legacy} and ${target} explicitly`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const legacyContents = await readFile(legacy, 'utf8');
    await writeFile(target, withCapabilityReceipt(legacyContents), { flag: 'wx' });
    await rm(legacy);
    writeLine(target);
    process.exit(0);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
try {
  await writeFile(target, template, { flag: options.force === true ? 'w' : 'wx' });
} catch (error) {
  if (error.code === 'EEXIST') throw new Error(`${target} already exists; pass --force to replace it`);
  throw error;
}
if (!auditPath && normalizedProfile !== 'Micro') {
  await initializeRunState(runtimeDirectory, {
    startingHead: head,
    planId: String(options['plan-id'] || 'unregistered-plan'),
    planSource: String(options['plan-source'] || 'user-approved request'),
    overwrite: options.force === true
  });
  await initializeExecutionBudget(runtimeDirectory, normalizedProfile, {
    tokenThreshold: integerOption(options, 'token-threshold', null),
    limits: convergenceConfig.autonomous_convergence.limits,
    overwrite: options.force === true
  });
  await writeFile(
    path.join(runtimeDirectory, 'convergence-config.json'),
    `${JSON.stringify(convergenceConfig, null, 2)}\n`,
    { flag: options.force === true ? 'w' : 'wx' }
  );
  if (selfHostingCandidate) {
    await writeFile(path.join(runtimeDirectory, 'bootstrap.json'), `${JSON.stringify({
      schema_version: 1,
      candidate_version: selfHostingCandidate,
      governing_policy: 'external_accepted_policy',
      candidate_rules_authoritative: false,
      candidate_test_scope: 'isolated_fixtures_and_package_homes',
      accepted_policy: acceptedPolicy,
      created_at: new Date().toISOString()
    }, null, 2)}\n`, { flag: options.force === true ? 'w' : 'wx' });
  }
}
writeLine(target);
