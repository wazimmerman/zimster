import { createHash, randomUUID } from 'node:crypto';
import { digestJson, stableJson } from './config-layers.mjs';

export const CAPABILITY_CLASSES = Object.freeze(['economy', 'balanced', 'expert', 'inherit']);
export const ROUTING_MODES = Object.freeze(['recommend', 'map_only', 'auto_within_policy', 'inherit']);
export const ROUTING_POLICIES = Object.freeze(['quality_first', 'balanced', 'cost_optimized']);
export const LEGACY_CLASS_ALIASES = Object.freeze({ fast: 'economy', standard: 'balanced', expert: 'expert' });

const selectedFields = [
  'role', 'ownership', 'tool_restrictions', 'dependency_cone',
  'stop_condition', 'acceptance_proof'
];

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
}

function requiredStringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${name} must be a non-empty array of strings`);
  }
}

export function validateDelegationDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('delegation decision must be an object');
  if (decision.schema_version !== 1) throw new Error('delegation schema_version must be 1');
  requiredString(decision.id, 'delegation id');
  requiredString(decision.run_id, 'delegation run_id');
  if (typeof decision.selected !== 'boolean') throw new Error('delegation selected must be boolean');
  requiredString(decision.reason, 'delegation reason');
  requiredString(decision.inline_assessment, 'delegation inline_assessment');
  requiredString(decision.created_at, 'delegation created_at');
  if (decision.selected) {
    for (const field of selectedFields) {
      if (field === 'ownership' || field === 'tool_restrictions' || field === 'dependency_cone') {
        requiredStringArray(decision[field], field);
      } else {
        requiredString(decision[field], field);
      }
    }
  } else {
    for (const field of selectedFields) {
      if (decision[field] !== undefined && decision[field] !== null) {
        throw new Error(`non-selected delegation must not contain ${field}`);
      }
    }
  }
  return decision;
}

export function normalizeCapabilityClass(value) {
  const normalized = LEGACY_CLASS_ALIASES[value] || value;
  if (!CAPABILITY_CLASSES.includes(normalized)) {
    throw new Error(`capability class must be one of ${CAPABILITY_CLASSES.join(', ')}`);
  }
  return normalized;
}

function normalizeProposalInputs(inputs) {
  return {
    delegation_id: inputs.delegation?.id || inputs.delegationId,
    task_signature: inputs.taskSignature || inputs.task_signature || {},
    git_fingerprint: inputs.gitFingerprint || inputs.git_fingerprint || 'unverified',
    config_digest: inputs.configDigest || inputs.config_digest || 'unverified',
    mapping_digest: inputs.mappingDigest || inputs.mapping_digest || 'unverified',
    harness: inputs.harness || 'unverified',
    harness_version: inputs.harnessVersion || inputs.harness_version || 'unverified',
    capability_digest: inputs.capabilityDigest || inputs.capability_digest || 'unverified',
    catalog_digest: inputs.catalogDigest || inputs.catalog_digest || 'unverified',
    explicit_override_digest: inputs.explicitOverrideDigest || inputs.explicit_override_digest || 'none'
  };
}

export function proposalInputFingerprint(inputs) {
  return createHash('sha256').update(stableJson(normalizeProposalInputs(inputs))).digest('hex');
}

export function createModelProposal({
  delegation,
  phase,
  capabilityClass,
  reasoningEffort,
  taskSignature,
  mode = 'inherit',
  policy = 'balanced',
  concreteModel = null,
  availability = 'unverified',
  supersedes = null,
  ...evidence
}) {
  validateDelegationDecision(delegation);
  if (!delegation.selected) throw new Error('delegation is not selected; model proposals are forbidden');
  if (!['plan', 'dispatch'].includes(phase)) throw new Error('proposal phase must be plan or dispatch');
  const capability = normalizeCapabilityClass(capabilityClass);
  if (!ROUTING_MODES.includes(mode)) throw new Error(`routing mode must be one of ${ROUTING_MODES.join(', ')}`);
  if (!ROUTING_POLICIES.includes(policy)) throw new Error(`routing policy must be one of ${ROUTING_POLICIES.join(', ')}`);
  requiredString(reasoningEffort, 'reasoning_effort');
  const input = normalizeProposalInputs({ delegation, taskSignature, ...evidence });
  return {
    schema_version: 1,
    id: randomUUID(),
    delegation_id: delegation.id,
    run_id: delegation.run_id,
    phase,
    authority: phase === 'plan' ? 'advisory' : 'authoritative',
    capability_class: capability,
    reasoning_effort: reasoningEffort,
    task_signature: structuredClone(taskSignature || {}),
    mode,
    policy,
    concrete_model: concreteModel,
    availability,
    git_fingerprint: input.git_fingerprint,
    config_digest: input.config_digest,
    mapping_digest: input.mapping_digest,
    harness: input.harness,
    harness_version: input.harness_version,
    capability_digest: input.capability_digest,
    catalog_digest: input.catalog_digest,
    explicit_override_digest: input.explicit_override_digest,
    input_fingerprint: digestJson(input),
    supersedes,
    superseded_by: null,
    status: 'active',
    created_at: new Date().toISOString()
  };
}

export function assertAuthoritativeProposal(proposal, currentInputs) {
  if (!proposal || proposal.phase !== 'dispatch' || proposal.authority !== 'authoritative') {
    throw new Error('dispatch requires an authoritative dispatch-phase proposal');
  }
  if (proposal.superseded_by) throw new Error(`proposal was superseded by ${proposal.superseded_by}`);
  if (proposal.status !== 'active') throw new Error(`proposal must be active and unconsumed; status is ${proposal.status}`);
  const expected = proposalInputFingerprint(currentInputs);
  if (proposal.input_fingerprint !== expected) throw new Error('proposal input fingerprint is stale');
  return proposal;
}

export function proposalInputs(proposal) {
  return {
    delegationId: proposal.delegation_id,
    taskSignature: proposal.task_signature,
    gitFingerprint: proposal.git_fingerprint,
    configDigest: proposal.config_digest,
    mappingDigest: proposal.mapping_digest,
    harness: proposal.harness,
    harnessVersion: proposal.harness_version,
    capabilityDigest: proposal.capability_digest,
    catalogDigest: proposal.catalog_digest,
    explicitOverrideDigest: proposal.explicit_override_digest
  };
}

export function resolveProposal(proposal, currentInputs = proposalInputs(proposal)) {
  assertAuthoritativeProposal(proposal, currentInputs);
  return {
    schema_version: 1,
    id: randomUUID(),
    proposal_id: proposal.id,
    delegation_id: proposal.delegation_id,
    run_id: proposal.run_id,
    action: 'inherit',
    capability_class: proposal.capability_class,
    mode: proposal.mode,
    policy: proposal.policy,
    requested_model: 'inherit',
    requested_effort: 'inherit',
    availability: proposal.availability,
    enforcement: 'inherit',
    effective_reporting: 'unverified',
    mapping_source: 'inherit',
    mapping_digest: proposal.mapping_digest,
    fallback_trace: ['inherit'],
    created_at: new Date().toISOString()
  };
}

export function validateRoutingConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('configuration must be an object');
  const routing = config.routing || config;
  if (routing.mode !== undefined && !ROUTING_MODES.includes(routing.mode)) throw new Error('unsupported routing mode');
  if (routing.policy !== undefined && !ROUTING_POLICIES.includes(routing.policy)) throw new Error('unsupported routing policy');
  if (routing.strict_cost === true && routing.policy !== 'cost_optimized') {
    throw new Error('strict_cost requires cost_optimized policy');
  }
  return config;
}
