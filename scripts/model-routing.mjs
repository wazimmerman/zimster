import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import {
  digestJson,
  loadConfigLayers,
  resolveProjectConfigPath,
  resolveUserConfigPath
} from './lib/config-layers.mjs';
import {
  createModelProposal,
  resolveRoutingProposal,
  summarizeRoutingObservations,
  validateDelegationDecision,
  validateRoutingConfig
} from './lib/model-routing.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = action === 'validate-config' ? process.cwd() : findRepoRoot(process.cwd());

async function parseJsonFile(filePath) {
  return JSON.parse(await readFile(path.resolve(root, filePath), 'utf8'));
}

function jsonOption(name, fallback = {}) {
  if (options[name] === undefined) return fallback;
  try { return JSON.parse(String(options[name])); } catch { throw new Error(`--${name} must be valid JSON`); }
}

function requiredJsonOption(name) {
  required(options, name);
  return jsonOption(name);
}

async function storage() {
  const runtime = await ensureRuntimeDirectory(root);
  const directory = path.join(runtime, 'routing');
  await mkdir(directory, { recursive: true });
  try { await writeFile(path.join(directory, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return {
    runtime,
    proposals: path.join(directory, 'proposals.jsonl'),
    resolutions: path.join(directory, 'resolutions.jsonl'),
    observations: path.join(directory, 'observations.jsonl')
  };
}

async function jsonl(file) {
  try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function writeJsonl(file, rows) {
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function decisionById(runtime, id) {
  const rows = await jsonl(path.join(runtime, 'delegation', 'decisions.jsonl'));
  const decision = rows.find((row) => row.id === id);
  if (!decision) throw new Error(`delegation decision not found: ${id}`);
  return decision;
}

async function effectiveConfiguration(runtime) {
  const harnessNative = options['harness-config']
    ? await parseJsonFile(String(options['harness-config']))
    : null;
  const harnessPath = options['harness-config']
    ? path.resolve(root, String(options['harness-config']))
    : null;
  const snapshotPath = path.join(runtime, 'routing', 'run-config.json');
  if (options.config) {
    const supplied = validateRoutingConfig(await parseJsonFile(String(options.config)));
    await writeFile(snapshotPath, `${JSON.stringify(supplied, null, 2)}\n`);
  }
  const layers = await loadConfigLayers({
    runPath: snapshotPath,
    projectPath: resolveProjectConfigPath(root),
    userPath: resolveUserConfigPath(),
    harnessNative,
    harnessPath
  });
  const effective = {
    schema_version: 1,
    routing: {
      mode: 'inherit',
      policy: 'balanced',
      strict_cost: false,
      mappings: {},
      ...(layers.effective.routing || {})
    },
    ...(layers.effective.autonomous_convergence
      ? { autonomous_convergence: layers.effective.autonomous_convergence }
      : {})
  };
  validateRoutingConfig(effective);
  return { config: effective, layers };
}

async function main() {
  if (action === 'validate-config') {
    const config = validateRoutingConfig(await parseJsonFile(required(options, 'config')));
    writeLine(JSON.stringify({ valid: true, digest: digestJson(config) }));
    return;
  }
  const files = await storage();
  if (action === 'list') {
    for (const row of await jsonl(files.proposals)) writeLine(JSON.stringify(row));
    return;
  }
  if (action === 'resolve') {
    const proposalId = required(options, 'proposal-id');
    const proposals = await jsonl(files.proposals);
    const proposal = [...proposals].reverse().find((row) => row.id === proposalId);
    if (!proposal) throw new Error(`model proposal not found: ${proposalId}`);
    const { config, layers } = await effectiveConfiguration(files.runtime);
    const routing = config.routing || config;
    const catalog = options.catalog ? await parseJsonFile(String(options.catalog)) : null;
    const capabilityEvidence = options.capabilities ? await parseJsonFile(String(options.capabilities)) : {};
    const explicitOverride = options.override ? requiredJsonOption('override') : null;
    const git = await captureGitState(root);
    const currentInputs = {
      delegationId: proposal.delegation_id,
      sessionId: required(options, 'session-id'),
      taskSignature: requiredJsonOption('task-signature'),
      gitFingerprint: git.working_tree_hash,
      configDigest: digestJson(config),
      mappingDigest: digestJson(routing.mappings || {}),
      harness: required(options, 'harness'),
      harnessVersion: required(options, 'harness-version'),
      capabilityDigest: capabilityEvidence && Object.keys(capabilityEvidence).length
        ? digestJson(capabilityEvidence) : required(options, 'capability-digest'),
      catalogDigest: catalog ? digestJson(catalog) : required(options, 'catalog-digest'),
      explicitOverrideDigest: explicitOverride ? digestJson(explicitOverride) : 'none'
    };
    const resolution = resolveRoutingProposal({
      proposal,
      currentInputs,
      mappings: routing.mappings || {},
      catalog,
      mappingSource: options['mapping-source']
        ? String(options['mapping-source'])
        : layers.mapping_sources,
      explicitOverride,
      capabilityEvidence,
      strictCost: options['strict-cost'] === true || routing.strict_cost === true,
      enforcement: String(options.enforcement || 'unverified'),
      effectiveReporting: String(options['effective-reporting'] || 'unverified'),
      delegationRequirement: String(options['delegation-requirement'] || 'optional'),
      configurationLayers: layers.layer_evidence
    });
    await appendFile(files.resolutions, `${JSON.stringify(resolution)}\n`);
    writeLine(JSON.stringify(resolution));
    return;
  }
  if (action === 'observe') {
    const dispatchId = required(options, 'dispatch');
    const dispatches = await jsonl(path.join(files.runtime, 'dispatches', 'dispatches.jsonl'));
    const dispatch = dispatches.find((row) => row.id === dispatchId);
    if (!dispatch) throw new Error(`dispatch record not found: ${dispatchId}`);
    if (dispatch.schema_version !== 2) throw new Error('routing observations require dispatch v2');
    if (!['accepted', 'rejected'].includes(dispatch.owner_acceptance?.status)) {
      throw new Error('owner acceptance must be recorded before observation');
    }
    const existingObservations = await jsonl(files.observations);
    if (existingObservations.some((row) => row.dispatch_id === dispatchId)) {
      throw new Error(`dispatch already has a routing observation: ${dispatchId}`);
    }
    const proposals = await jsonl(files.proposals);
    const proposal = proposals.find((row) => row.id === dispatch.proposal_id);
    if (!proposal) throw new Error(`proposal not found for dispatch: ${dispatch.proposal_id}`);
    const signature = proposal.task_signature || {};
    const observation = {
      schema_version: 1,
      id: randomUUID(),
      run_id: dispatch.run_id,
      dispatch_id: dispatch.id,
      harness: proposal.harness,
      harness_version_family: String(proposal.harness_version).split('.').slice(0, 2).join('.'),
      role: dispatch.role,
      risk: signature.risk || 'unverified',
      capability_class: dispatch.capability_class,
      task_traits: signature.traits || [],
      proof_kind: signature.proof_kind || 'unverified',
      requested_model: dispatch.requested_model,
      requested_effort: dispatch.requested_effort,
      effective_model: dispatch.effective_model,
      effective_effort: dispatch.effective_effort,
      owner_acceptance: dispatch.owner_acceptance.status,
      evidence_references: dispatch.owner_acceptance.proof ? [dispatch.owner_acceptance.proof] : [],
      observed_cost: options.cost ? Number(options.cost) : null,
      observed_duration_ms: options['duration-ms'] ? Number(options['duration-ms']) : null,
      created_at: new Date().toISOString()
    };
    await appendFile(files.observations, `${JSON.stringify(observation)}\n`);
    writeLine(JSON.stringify(observation));
    return;
  }
  if (action === 'summarize') {
    const signature = jsonOption('task-signature');
    const summary = summarizeRoutingObservations(await jsonl(files.observations), signature);
    writeLine(JSON.stringify(summary));
    return;
  }
  if (action !== 'propose') {
    throw new Error('Usage: model-routing.mjs <validate-config|propose|resolve|observe|summarize|list>');
  }
  const delegation = await decisionById(files.runtime, required(options, 'delegation-id'));
  validateDelegationDecision(delegation);
  if (!delegation.selected) throw new Error('delegation is not selected; model proposals are forbidden');
  const { config } = await effectiveConfiguration(files.runtime);
  const routing = config.routing || config;
  const catalog = options.catalog ? await parseJsonFile(String(options.catalog)) : null;
  const capabilityEvidence = options.capabilities ? await parseJsonFile(String(options.capabilities)) : {};
  const explicitOverride = options.override ? requiredJsonOption('override') : null;
  const git = await captureGitState(root);
  const proposal = createModelProposal({
    delegation,
    phase: required(options, 'phase'),
    capabilityClass: required(options, 'capability-class'),
    reasoningEffort: required(options, 'reasoning-effort'),
    taskSignature: jsonOption('task-signature'),
    mode: String(options.mode || routing.mode || 'inherit'),
    policy: String(options.policy || routing.policy || 'balanced'),
    gitFingerprint: git.working_tree_hash,
    configDigest: digestJson(config),
    mappingDigest: digestJson(routing.mappings || {}),
    harness: String(options.harness || 'unverified'),
    harnessVersion: String(options['harness-version'] || 'unverified'),
    capabilityDigest: String(options['capability-digest']
      || (Object.keys(capabilityEvidence).length ? digestJson(capabilityEvidence) : 'unverified')),
    catalogDigest: String(options['catalog-digest'] || (catalog ? digestJson(catalog) : 'unverified')),
    explicitOverrideDigest: explicitOverride ? digestJson(explicitOverride) : 'none',
    supersedes: options.supersedes ? String(options.supersedes) : null,
    sessionId: options['session-id'] ? String(options['session-id']) : null
  });
  if (proposal.mode !== 'inherit' && Object.keys(routing.mappings || {}).length) {
    const resolvable = { ...proposal, phase: 'dispatch', authority: 'authoritative' };
    const preview = resolveRoutingProposal({
      proposal: resolvable,
      mappings: routing.mappings || {},
      catalog,
      capabilityEvidence,
      explicitOverride,
      enforcement: String(options.enforcement || 'unverified'),
      effectiveReporting: String(options['effective-reporting'] || 'unverified')
    });
    const recommendation = preview.recommendation || (preview.action === 'request'
      ? { model: preview.requested_model, effort: preview.requested_effort }
      : null);
    proposal.concrete_model = recommendation?.model || null;
    proposal.reasoning_effort = recommendation?.effort || proposal.reasoning_effort;
    proposal.availability = recommendation ? 'available' : preview.availability;
  }
  if (proposal.supersedes) {
    const proposals = await jsonl(files.proposals);
    const previous = proposals.find((row) => row.id === proposal.supersedes);
    if (!previous) throw new Error(`superseded proposal not found: ${proposal.supersedes}`);
    if (previous.status !== 'active') throw new Error(`superseded proposal must be active; status is ${previous.status}`);
    if (previous.delegation_id !== proposal.delegation_id) throw new Error('superseded proposal belongs to a different delegation decision');
    previous.status = 'invalidated';
    previous.superseded_by = proposal.id;
    await writeJsonl(files.proposals, [...proposals, proposal]);
  } else {
    await appendFile(files.proposals, `${JSON.stringify(proposal)}\n`);
  }
  writeLine(JSON.stringify(proposal));
}

main().catch((error) => {
  writeError(error.message);
  process.exitCode = 1;
});
