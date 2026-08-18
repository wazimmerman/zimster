import { randomUUID } from 'node:crypto';

export const CONVERGENCE_METRICS = Object.freeze([
  'correction_commits',
  'correction_rechecks',
  'final_integration_reviews',
  'final_verification_attempts',
  'complete_suite_executions',
  'exact_duplicate_commands',
  'context_renewals'
]);

export const CONVERGENCE_ALIASES = Object.freeze({
  final_correction_waves: 'correction_commits',
  review_rechecks_per_seam: 'correction_rechecks',
  context_compactions: 'context_renewals'
});
const SCOPES = Object.freeze(['in-scope', 'out-of-scope']);
const SENSITIVITIES = Object.freeze(['ordinary', 'sensitive']);
const LOCALITIES = Object.freeze(['local', 'external']);
const CONDITIONS = Object.freeze([null, 'contradiction', 'missing_independent_review', 'policy_required_approval']);

export function normalizeConvergenceMetric(metric) {
  return CONVERGENCE_ALIASES[metric] || metric;
}

export function validateConvergenceConfig(config) {
  if (!config || config.schema_version !== 1) throw new Error('convergence configuration schema_version must be 1');
  const convergence = config.autonomous_convergence;
  if (!convergence || typeof convergence.enabled !== 'boolean') {
    throw new Error('autonomous_convergence.enabled must be boolean');
  }
  const limits = convergence.limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new Error('autonomous_convergence.limits must be an object');
  }
  for (const metric of CONVERGENCE_METRICS) {
    if (!Number.isInteger(limits[metric]) || limits[metric] < 0) {
      throw new Error(`${metric} must be a non-negative integer`);
    }
  }
  if (convergence.hard_limits !== undefined) {
    if (!Array.isArray(convergence.hard_limits)) {
      throw new Error('autonomous_convergence.hard_limits must be an array');
    }
    for (const metric of convergence.hard_limits) {
      if (!CONVERGENCE_METRICS.includes(metric)) {
        throw new Error(`unknown hard convergence limit: ${metric}`);
      }
    }
  }
  return config;
}

export function decideConvergence({
  event,
  scope,
  sensitivity,
  reversible,
  authorized,
  deterministic,
  locality,
  metric,
  used,
  limit,
  condition = null,
  enabled = true
}) {
  if (typeof event !== 'string' || !event.trim()) throw new Error('convergence event must be a non-empty string');
  if (!SCOPES.includes(scope)) throw new Error('convergence scope must be in-scope or out-of-scope');
  if (!SENSITIVITIES.includes(sensitivity)) throw new Error('convergence sensitivity must be ordinary or sensitive');
  if (!LOCALITIES.includes(locality)) throw new Error('convergence locality must be local or external');
  for (const [name, value] of Object.entries({ reversible, authorized, deterministic, enabled })) {
    if (typeof value !== 'boolean') throw new Error(`convergence ${name} must be boolean`);
  }
  if (!CONDITIONS.includes(condition)) throw new Error('convergence condition is unsupported');
  const canonicalMetric = normalizeConvergenceMetric(metric);
  if (!CONVERGENCE_METRICS.includes(canonicalMetric)) throw new Error(`unknown convergence metric: ${metric}`);
  if (!Number.isInteger(used) || used < 0 || !Number.isInteger(limit) || limit < 0) {
    throw new Error('convergence used and limit must be non-negative integers');
  }
  let reason = null;
  if (condition === 'contradiction') reason = 'contradiction';
  else if (scope === 'out-of-scope') reason = 'material_scope_expansion';
  else if (sensitivity === 'sensitive' && authorized !== true) reason = 'sensitive_decision_lacks_authority';
  else if (condition === 'missing_independent_review') reason = 'missing_independent_review';
  else if (
    condition === 'policy_required_approval'
    || enabled !== true
    || reversible !== true
    || deterministic !== true
    || locality !== 'local'
  ) reason = 'policy_required_approval';
  if (reason) return { outcome: 'escalate', reason, metric: canonicalMetric, used, limit };
  if (used >= limit) return { outcome: 'budget_exhausted', reason: 'exhausted_budget', metric: canonicalMetric, used, limit };
  return {
    outcome: 'continue',
    reason: 'ordinary_deterministic_in_scope_failure',
    metric: canonicalMetric,
    used,
    limit
  };
}

export function convergenceRecord({
  runId,
  event,
  scope,
  sensitivity,
  reversible,
  authorized,
  deterministic,
  locality,
  condition,
  enabled,
  decision
}) {
  return {
    schema_version: 1,
    id: randomUUID(),
    run_id: runId,
    event,
    outcome: decision.outcome,
    reason: decision.reason,
    scope,
    sensitivity,
    reversible,
    authorized,
    deterministic,
    locality,
    condition,
    autonomous_convergence_enabled: enabled,
    metric: decision.metric,
    used: decision.used,
    limit: decision.limit,
    created_at: new Date().toISOString()
  };
}
