import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseOptions, required, integerOption, writeError, writeLine } from './lib/cli.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory, migrateLegacyJsonlStore } from './lib/runtime.mjs';
import { digestJson } from './lib/config-layers.mjs';
import {
  normalizeCapabilityClass,
  proposalInputFingerprint,
  validateDelegationDecision
} from './lib/model-routing.mjs';
import {
  commitDispatchClaim,
  recoverProposalClaim,
  reserveProposalForDispatch
} from './lib/proposal-state.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());
let directory;
let file;
const capabilityClasses = new Set(['economy', 'balanced', 'expert', 'inherit']);

async function init() {
  const runtime = await ensureRuntimeDirectory(root);
  await migrateLegacyJsonlStore(root, runtime, 'dispatches', 'dispatches.jsonl');
  directory ||= path.join(runtime, 'dispatches');
  file ||= path.join(directory, 'dispatches.jsonl');
  await mkdir(directory, { recursive: true });
  try { await writeFile(path.join(directory, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  try { await readFile(file, 'utf8'); } catch { await writeFile(file, ''); }
}

async function rows() {
  await init();
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function replaceRows(records) {
  await writeFile(file, records.map((row) => JSON.stringify(row)).join('\n') + (records.length ? '\n' : ''));
}

function addInheritanceWarning(row) {
  delete row.warning;
  if (row.tier === 'fast' && row.parent_model && row.effective_model !== 'unverified' && row.effective_model === row.parent_model) {
    row.warning = 'Fast-tier task inherited the parent model; verify that this was intentional.';
  }
  return row;
}

function normalizeLegacy(row) {
  if (row.schema_version !== 1) return row;
  return {
    ...row,
    capability_class: normalizeCapabilityClass(row.tier),
    delegation_id: 'legacy_unavailable',
    proposal_id: 'legacy_unavailable',
    resolution_id: 'legacy_unavailable',
    availability: 'legacy_unavailable',
    enforcement: 'legacy_unavailable',
    fallback_trace: ['legacy_unavailable'],
    owner_acceptance: { status: 'legacy_unavailable' }
  };
}

async function runtimeRows(runtime, ...segments) {
  try {
    return (await readFile(path.join(runtime, ...segments), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function jsonOption(name) {
  const raw = required(options, name);
  try { return JSON.parse(String(raw)); } catch { throw new Error(`--${name} must be valid JSON`); }
}

async function verifyConfigurationLayers(layers = []) {
  for (const layer of layers) {
    let currentDigest = 'absent';
    try {
      currentDigest = digestJson(JSON.parse(await readFile(layer.path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`routing configuration layer is unreadable or invalid: ${layer.source}`);
    }
    if (currentDigest !== layer.digest) {
      throw new Error(`routing configuration layer changed after resolution: ${layer.source}`);
    }
  }
}

async function main() {
  if (action === 'init') {
    await init();
    writeLine(directory);
    return;
  }
  if (action === 'list') {
    await init();
    if (options.normalized === true) {
      for (const row of await rows()) writeLine(JSON.stringify(normalizeLegacy(row)));
    } else {
      process.stdout.write(await readFile(file, 'utf8'));
    }
    return;
  }
  if (action === 'update') {
    const id = required(options, 'id');
    const records = await rows();
    const row = records.find((item) => item.id === id);
    if (!row) throw new Error(`dispatch record not found: ${id}`);
    if (options['effective-model']) row.effective_model = String(options['effective-model']);
    if (options['effective-effort']) row.effective_effort = String(options['effective-effort']);
    if (options['agent-id']) row.agent_id = String(options['agent-id']);
    if (options['owner-acceptance']) {
      if (row.schema_version !== 2) throw new Error('owner acceptance is available only for dispatch v2');
      const status = String(options['owner-acceptance']);
      if (!['accepted', 'rejected'].includes(status)) throw new Error('--owner-acceptance must be accepted or rejected');
      const proof = required(options, 'acceptance-proof');
      row.owner_acceptance = {
        status,
        proof,
        accepted_at: status === 'accepted' ? new Date().toISOString() : null,
        decided_at: new Date().toISOString()
      };
    }
    if (row.schema_version === 2 && row.effective_model !== 'unverified') {
      row.routing_match = row.requested_model === 'inherit'
        ? 'not_applicable'
        : row.requested_model === row.effective_model ? 'matched' : 'mismatch';
    }
    row.completed_at = new Date().toISOString();
    addInheritanceWarning(row);
    await replaceRows(records);
    writeLine(JSON.stringify(row));
    return;
  }
  if (action === 'recover') {
    const runtime = await ensureRuntimeDirectory(root);
    const result = await recoverProposalClaim(
      runtime,
      required(options, 'proposal-id'),
      required(options, 'claim-id')
    );
    writeLine(JSON.stringify(result));
    return;
  }
  if (action !== 'record') throw new Error('Usage: dispatch-record.mjs <init|record|update|recover|list>');
  if (!options['delegation-id']) {
    throw new Error('new dispatch records require --delegation-id; dispatch v1 is read-only compatibility data');
  }

  {
    const runtime = await ensureRuntimeDirectory(root);
    const decisions = await runtimeRows(runtime, 'delegation', 'decisions.jsonl');
    const decision = decisions.find((item) => item.id === String(options['delegation-id']));
    if (!decision) throw new Error(`delegation decision not found: ${options['delegation-id']}`);
    validateDelegationDecision(decision);
    if (!decision.selected) throw new Error('dispatch forbidden because delegation is not selected');
    const proposals = await runtimeRows(runtime, 'routing', 'proposals.jsonl');
    const proposal = proposals.find((item) => item.id === required(options, 'proposal-id'));
    if (!proposal) throw new Error(`model proposal not found: ${options['proposal-id']}`);
    if (proposal.phase !== 'dispatch' || proposal.authority !== 'authoritative') throw new Error('dispatch requires an authoritative dispatch proposal');
    if (proposal.status !== 'active') throw new Error(`proposal is ${proposal.status}; proposals are single-use`);
    if (proposal.superseded_by) throw new Error('proposal is superseded');
    if (proposal.delegation_id !== decision.id) throw new Error('proposal does not belong to the delegation decision');
    const resolutions = await runtimeRows(runtime, 'routing', 'resolutions.jsonl');
    const resolution = resolutions.find((item) => item.id === required(options, 'resolution-id'));
    if (!resolution || resolution.proposal_id !== proposal.id) throw new Error('authoritative routing resolution not found for proposal');
    if (!['request', 'inherit'].includes(resolution.action)) {
      throw new Error(`routing resolution action ${resolution.action} is not dispatchable`);
    }
    if (resolution.delegation_id !== decision.id || resolution.run_id !== decision.run_id || proposal.run_id !== decision.run_id) {
      throw new Error('delegation, proposal, and resolution run linkage mismatch');
    }
    if (resolution.proposal_input_fingerprint !== proposal.input_fingerprint) {
      throw new Error('routing resolution input fingerprint does not match the proposal');
    }
    const role = required(options, 'role');
    if (role !== decision.role) throw new Error(`dispatch role mismatch: delegation selected ${decision.role}`);
    if (proposal.task_signature?.role !== decision.role) {
      throw new Error('proposal task signature role does not match the delegation role');
    }
    const currentInputs = {
      delegationId: decision.id,
      sessionId: required(options, 'session-id'),
      taskSignature: jsonOption('task-signature'),
      gitFingerprint: (await captureGitState(root)).working_tree_hash,
      configDigest: proposal.config_digest,
      mappingDigest: proposal.mapping_digest,
      harness: required(options, 'harness'),
      harnessVersion: required(options, 'harness-version'),
      capabilityDigest: required(options, 'capability-digest'),
      catalogDigest: required(options, 'catalog-digest'),
      explicitOverrideDigest: options['explicit-override-digest']
        ? String(options['explicit-override-digest'])
        : options.override ? digestJson(jsonOption('override')) : 'none'
    };
    if (proposalInputFingerprint(currentInputs) !== proposal.input_fingerprint
      || digestJson(resolution.current_inputs) !== digestJson({
        delegation_id: currentInputs.delegationId,
        session_id: currentInputs.sessionId,
        task_signature: currentInputs.taskSignature,
        git_fingerprint: currentInputs.gitFingerprint,
        config_digest: currentInputs.configDigest,
        mapping_digest: currentInputs.mappingDigest,
        harness: currentInputs.harness,
        harness_version: currentInputs.harnessVersion,
        capability_digest: currentInputs.capabilityDigest,
        catalog_digest: currentInputs.catalogDigest,
        explicit_override_digest: currentInputs.explicitOverrideDigest
      })) {
      throw new Error('routing inputs changed after authoritative resolution');
    }
    await verifyConfigurationLayers(resolution.configuration_layers);
    const capabilityClass = required(options, 'capability-class');
    if (!capabilityClasses.has(capabilityClass)) throw new Error('--capability-class must be economy, balanced, expert, or inherit');
    const expectedClass = resolution.action === 'request'
      ? resolution.selected_class
      : proposal.capability_class;
    if (capabilityClass !== expectedClass) {
      throw new Error(`dispatch capability-class mismatch: resolution requires ${expectedClass}`);
    }
    const git = await captureGitState(root);
    if (git.working_tree_hash !== proposal.git_fingerprint || resolution.git_fingerprint !== proposal.git_fingerprint) {
      throw new Error('dispatch proposal is stale because the working-tree fingerprint changed');
    }
    const row = {
      schema_version: 2,
      id: randomUUID(),
      run_id: decision.run_id,
      delegation_id: decision.id,
      proposal_id: proposal.id,
      proposal_claim_id: null,
      resolution_id: resolution.id,
      session_id: proposal.session_id,
      role,
      purpose: required(options, 'purpose'),
      capability_class: capabilityClass,
      requested_model: resolution.requested_model,
      requested_provider: resolution.requested_provider || null,
      requested_effort: resolution.requested_effort,
      effective_model: String(options['effective-model'] || 'unverified'),
      effective_effort: String(options['effective-effort'] || 'unverified'),
      availability: resolution.availability,
      enforcement: resolution.enforcement,
      effective_reporting: resolution.effective_reporting,
      resolution_mode: resolution.mode,
      mapping_source: resolution.mapping_source,
      mapping_digest: resolution.mapping_digest,
      fallback_trace: resolution.fallback_trace,
      parent_model: options['parent-model'] ? String(options['parent-model']) : null,
      agent_id: options['agent-id'] ? String(options['agent-id']) : null,
      turn_limit: integerOption(options, 'turn-limit', 12),
      commit_permission: String(options['commit-permission'] || 'none'),
      ownership: decision.ownership,
      tool_restrictions: decision.tool_restrictions,
      dependency_cone: decision.dependency_cone,
      stop_condition: decision.stop_condition,
      acceptance_proof: decision.acceptance_proof,
      task_signature: proposal.task_signature,
      output_path: options.output ? String(options.output) : null,
      owner_acceptance: { status: 'pending', proof: null, accepted_at: null },
      created_at: new Date().toISOString()
    };
    await init();
    const reservation = await reserveProposalForDispatch(runtime, proposal.id);
    row.proposal_claim_id = reservation.claim.id;
    const recorded = await commitDispatchClaim(runtime, reservation.claim.id, row);
    writeLine(JSON.stringify(recorded));
    return;
  }
}

main().catch((error) => {
  writeError(error.message);
  process.exitCode = 1;
});
