import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { integerOption, parseOptions, writeLine } from './lib/cli.mjs';
import { findRepoRoot, gitValue } from './lib/git-state.mjs';
import { ensureRuntimeDirectory, resolveAuditPath } from './lib/runtime.mjs';
import { harnessCapabilities } from './lib/capabilities.mjs';
import { initializeExecutionBudget } from './lib/execution-budget.mjs';

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
  await initializeExecutionBudget(runtimeDirectory, normalizedProfile, {
    tokenThreshold: integerOption(options, 'token-threshold', null),
    overwrite: options.force === true
  });
}
writeLine(target);
