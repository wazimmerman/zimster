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
    session_id: inputs.sessionId || inputs.session_id || null,
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
  sessionId = null,
  ...evidence
}) {
  validateDelegationDecision(delegation);
  if (!delegation.selected) throw new Error('delegation is not selected; model proposals are forbidden');
  if (!['plan', 'dispatch'].includes(phase)) throw new Error('proposal phase must be plan or dispatch');
  if (phase === 'dispatch') requiredString(sessionId, 'session_id');
  const capability = normalizeCapabilityClass(capabilityClass);
  if (!ROUTING_MODES.includes(mode)) throw new Error(`routing mode must be one of ${ROUTING_MODES.join(', ')}`);
  if (!ROUTING_POLICIES.includes(policy)) throw new Error(`routing policy must be one of ${ROUTING_POLICIES.join(', ')}`);
  requiredString(reasoningEffort, 'reasoning_effort');
  if (!taskSignature || taskSignature.role !== delegation.role) {
    throw new Error(`proposal task signature role must match delegation role ${delegation.role}`);
  }
  const input = normalizeProposalInputs({ delegation, taskSignature, sessionId, ...evidence });
  return {
    schema_version: 1,
    id: randomUUID(),
    delegation_id: delegation.id,
    run_id: delegation.run_id,
    session_id: phase === 'dispatch' ? sessionId : null,
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
    sessionId: proposal.session_id,
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
    requested_provider: null,
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

const classOrder = ['economy', 'balanced', 'expert'];

function availabilityState(catalog) {
  if (!catalog || catalog.status === undefined) return 'unverified';
  if (catalog.status === 'current') return 'available';
  return catalog.status;
}

function versionParts(version) {
  return String(version).match(/\d+(?:\.\d+)*/)?.[0].split('.').map(Number) || [];
}

function versionAtLeast(actual, minimum) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  if (!left.length || !right.length) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function candidateEligibility(candidate, {
  harness = 'unverified',
  harnessVersion = 'unverified',
  catalog = null,
  capabilityEvidence = {}
} = {}) {
  if (candidate.harnesses && !candidate.harnesses.includes(harness)) {
    return { eligible: false, reason: `harness_constraint:${harness}` };
  }
  if (candidate.minimum_harness_version && !versionAtLeast(harnessVersion, candidate.minimum_harness_version)) {
    return { eligible: false, reason: `harness_version_constraint:${candidate.minimum_harness_version}` };
  }
  for (const capability of candidate.required_capabilities || []) {
    if (!['native', 'supported_with_constraints'].includes(capabilityEvidence[capability])) {
      return { eligible: false, reason: `capability_unavailable:${capability}` };
    }
  }
  if (candidate.availability === 'declared_available' && candidate.availability_source) {
    return { eligible: true, reason: 'declared_available' };
  }
  if (catalog?.status !== 'current') return { eligible: false, reason: 'catalog_unverified' };
  if (Array.isArray(catalog.models)) {
    const matched = catalog.models.find((row) =>
      row.model === candidate.model && (!candidate.provider || row.provider === candidate.provider)
    );
    return matched
      ? { eligible: true, reason: 'catalog_available' }
      : { eligible: false, reason: candidate.provider ? 'provider_or_model_unavailable' : 'model_unavailable' };
  }
  if (candidate.provider) return { eligible: false, reason: 'provider_unverified' };
  return Array.isArray(catalog.available_models) && catalog.available_models.includes(candidate.model)
    ? { eligible: true, reason: 'catalog_available' }
    : { eligible: false, reason: 'model_unavailable' };
}

function candidateResolution(candidate, catalog, fallbackTrace) {
  const effortSupported = !candidate.effort
    || (Array.isArray(catalog?.supported_efforts) && catalog.supported_efforts.includes(candidate.effort));
  if (!effortSupported) {
    fallbackTrace.push(Array.isArray(catalog?.supported_efforts)
      ? `unsupported_effort:${candidate.effort}:inherit`
      : `effort_support_unverified:${candidate.effort}:inherit`);
  }
  return {
    requested_model: candidate.model,
    requested_provider: candidate.provider || null,
    requested_effort: effortSupported ? (candidate.effort || 'inherit') : 'inherit'
  };
}

function selectedMappingSource(mappingSource, capabilityClass) {
  if (mappingSource && typeof mappingSource === 'object') {
    return mappingSource[capabilityClass] || 'inherit';
  }
  return mappingSource || 'inherit';
}

function comparableSignature(observation) {
  return {
    harness: observation.harness,
    harness_version_family: observation.harness_version_family,
    role: observation.role,
    risk: observation.risk,
    capability_class: observation.capability_class,
    task_traits: observation.task_traits || observation.traits || [],
    proof_kind: observation.proof_kind
  };
}

export function resolveRoutingProposal({
  proposal,
  currentInputs = proposalInputs(proposal),
  mappings = {},
  catalog = null,
  mappingSource = 'configuration',
  explicitOverride = null,
  capabilityEvidence = {},
  strictCost = false,
  enforcement = 'unverified',
  effectiveReporting = 'unverified',
  delegationRequirement = 'optional',
  configurationLayers = []
}) {
  assertAuthoritativeProposal(proposal, currentInputs);
  const fallbackTrace = [];
  const base = {
    schema_version: 1,
    id: randomUUID(),
    proposal_id: proposal.id,
    delegation_id: proposal.delegation_id,
    run_id: proposal.run_id,
    capability_class: proposal.capability_class,
    mode: proposal.mode,
    policy: proposal.policy,
    mapping_source: selectedMappingSource(mappingSource, proposal.capability_class),
    mapping_digest: proposal.mapping_digest,
    enforcement,
    effective_reporting: effectiveReporting,
    availability: availabilityState(catalog),
    class_escalations: 0,
    selected_class: 'inherit',
    recommendation: null,
    fallback_trace: fallbackTrace,
    proposal_input_fingerprint: proposal.input_fingerprint,
    current_inputs: normalizeProposalInputs(currentInputs),
    configuration_layers: structuredClone(configurationLayers),
    git_fingerprint: proposal.git_fingerprint,
    created_at: new Date().toISOString()
  };
  if (strictCost && proposal.policy !== 'cost_optimized') throw new Error('strict_cost requires cost_optimized policy');
  if (strictCost && (!['native', 'supported_with_constraints'].includes(enforcement)
    || !['native', 'supported_with_constraints'].includes(effectiveReporting))) {
    fallbackTrace.push('strict_cost_unenforceable');
    if (delegationRequirement === 'required_review') {
      return {
        ...base,
        action: 'blocked',
        requested_model: 'none',
        requested_provider: null,
        requested_effort: 'none',
        policy_exception_required: true,
        return_to_owner: false
      };
    }
    return {
      ...base,
      action: 'cancel',
      requested_model: 'none',
      requested_provider: null,
      requested_effort: 'none',
      policy_exception_required: false,
      return_to_owner: true
    };
  }

  if (proposal.mode === 'inherit' && !explicitOverride) {
    fallbackTrace.push('inherit_mode');
    return {
      ...base,
      action: 'inherit',
      requested_model: 'inherit',
      requested_provider: null,
      requested_effort: 'inherit',
      return_to_owner: false,
      policy_exception_required: false
    };
  }

  if (explicitOverride) {
    if (!explicitOverride.model) throw new Error('explicit override requires model');
    const eligibility = candidateEligibility(explicitOverride, {
      harness: proposal.harness, harnessVersion: proposal.harness_version, catalog, capabilityEvidence
    });
    if (!eligibility.eligible) {
      fallbackTrace.push(`explicit_override_unavailable:${eligibility.reason}:${explicitOverride.model}`);
      return {
        ...base,
        action: 'inherit', requested_model: 'inherit', requested_provider: null, requested_effort: 'inherit',
        return_to_owner: false, policy_exception_required: false
      };
    }
    const requested = candidateResolution(explicitOverride, catalog, fallbackTrace);
    return {
      ...base,
      ...requested,
      action: 'request',
      selected_class: proposal.capability_class,
      mapping_source: 'explicit_dispatch_override',
      availability: 'available',
      fallback_trace: fallbackTrace,
      return_to_owner: false,
      policy_exception_required: false
    };
  }

  const start = classOrder.indexOf(proposal.capability_class);
  const allowedClasses = start < 0 ? [] : [classOrder[start]];
  if (['auto_within_policy', 'recommend'].includes(proposal.mode)
    && proposal.policy !== 'cost_optimized' && start >= 0 && start < classOrder.length - 1) {
    allowedClasses.push(classOrder[start + 1]);
  }
  const candidates = [];
  for (const capabilityClass of allowedClasses) {
    for (const [index, candidate] of (mappings[capabilityClass] || []).entries()) {
      const eligibility = candidateEligibility(candidate, {
        harness: proposal.harness,
        harnessVersion: proposal.harness_version,
        catalog,
        capabilityEvidence
      });
      if (!eligibility.eligible) {
        fallbackTrace.push(`unavailable:${capabilityClass}:${candidate.model || index}:${eligibility.reason}`);
        continue;
      }
      candidates.push({ candidate, capabilityClass, index });
    }
  }
  if (!candidates.length) {
    fallbackTrace.push(catalog?.status === 'current' ? 'no_available_mapping' : 'catalog_unverified');
    return {
      ...base,
      action: 'inherit', requested_model: 'inherit', requested_provider: null, requested_effort: 'inherit',
      fallback_trace: fallbackTrace,
      return_to_owner: false, policy_exception_required: false
    };
  }

  let selectedCandidate;
  if (proposal.mode === 'map_only') {
    selectedCandidate = candidates.find(({ capabilityClass }) => capabilityClass === proposal.capability_class);
  } else {
    const rankName = proposal.policy === 'quality_first'
      ? 'quality_rank'
      : proposal.policy === 'balanced' ? 'balanced_rank' : 'cost_rank';
    selectedCandidate = [...candidates].sort((left, right) => {
      const leftRank = Number.isFinite(left.candidate[rankName]) ? left.candidate[rankName] : Number.MAX_SAFE_INTEGER;
      const rightRank = Number.isFinite(right.candidate[rankName]) ? right.candidate[rankName] : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    })[0];
  }
  if (!selectedCandidate) {
    fallbackTrace.push('no_mapping_for_proposed_class');
    return {
      ...base,
      action: 'inherit', requested_model: 'inherit', requested_provider: null, requested_effort: 'inherit',
      fallback_trace: fallbackTrace,
      return_to_owner: false, policy_exception_required: false
    };
  }
  const requested = candidateResolution(selectedCandidate.candidate, catalog, fallbackTrace);
  const classEscalations = selectedCandidate.capabilityClass === proposal.capability_class ? 0 : 1;
  if (classEscalations) fallbackTrace.push(`class_escalation:${proposal.capability_class}:${selectedCandidate.capabilityClass}`);
  if (proposal.mode === 'recommend') {
    return {
      ...base,
      action: 'inherit', requested_model: 'inherit', requested_provider: null, requested_effort: 'inherit',
      selected_class: selectedCandidate.capabilityClass,
      mapping_source: selectedMappingSource(mappingSource, selectedCandidate.capabilityClass),
      class_escalations: classEscalations,
      recommendation: { model: requested.requested_model, provider: requested.requested_provider, effort: requested.requested_effort },
      availability: 'available',
      fallback_trace: fallbackTrace,
      return_to_owner: false, policy_exception_required: false
    };
  }
  return {
    ...base,
    ...requested,
    action: 'request',
    selected_class: selectedCandidate.capabilityClass,
    mapping_source: selectedMappingSource(mappingSource, selectedCandidate.capabilityClass),
    class_escalations: classEscalations,
    availability: 'available',
    fallback_trace: fallbackTrace,
    return_to_owner: false,
    policy_exception_required: false
  };
}

export function summarizeRoutingObservations(observations, taskSignature) {
  const target = comparableSignature(taskSignature);
  const unique = [...new Map(observations.map((row) => [row.dispatch_id || row.id, row])).values()];
  const comparable = unique.filter((row) => stableJson(comparableSignature(row)) === stableJson(target));
  if (comparable.length < 3) {
    return { status: 'insufficient_evidence', comparable_count: comparable.length, minimum: 3 };
  }
  return {
    status: 'advisory',
    comparable_count: comparable.length,
    accepted_count: comparable.filter((row) => row.owner_acceptance === 'accepted').length,
    rejected_count: comparable.filter((row) => row.owner_acceptance === 'rejected').length,
    effective_model_verified_count: comparable.filter((row) => row.effective_model && row.effective_model !== 'unverified').length,
    note: 'Local categorical evidence is advisory and cannot mutate routing policy or mappings.'
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
  for (const [role, capabilityClass] of Object.entries(routing.role_classes || {})) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(role) || role === '.' || role === '..') {
      throw new Error(`routing role must be a safe basename: ${role}`);
    }
    normalizeCapabilityClass(capabilityClass);
  }
  for (const [capabilityClass, candidates] of Object.entries(routing.mappings || {})) {
    if (!classOrder.includes(capabilityClass)) throw new Error(`mappings cannot target ${capabilityClass}`);
    if (!Array.isArray(candidates)) throw new Error(`mapping ${capabilityClass} must be an array`);
    for (const candidate of candidates) {
      requiredString(candidate?.model, `mapping ${capabilityClass} model`);
      if (/[\r\n\0]/.test(candidate.model)) throw new Error(`mapping ${capabilityClass} model contains unsafe control characters`);
      for (const field of ['effort', 'provider']) {
        if (candidate[field] !== undefined && (typeof candidate[field] !== 'string' || /[\r\n\0]/.test(candidate[field]))) {
          throw new Error(`mapping ${capabilityClass} ${field} contains unsafe control characters`);
        }
      }
      for (const rank of ['quality_rank', 'balanced_rank', 'cost_rank']) {
        if (candidate[rank] !== undefined && (!Number.isFinite(candidate[rank]) || candidate[rank] < 0)) {
          throw new Error(`${rank} must be a non-negative number`);
        }
      }
      if (candidate.availability === 'declared_available' && !candidate.availability_source) {
        throw new Error('declared_available candidates require availability_source');
      }
    }
  }
  return config;
}
