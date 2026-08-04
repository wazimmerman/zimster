import { randomUUID } from 'node:crypto';

export const CONVERGENCE_METRICS = Object.freeze([
  'correction_commits',
  'review_rechecks_per_seam',
  'final_verification_attempts',
  'complete_suite_executions',
  'exact_duplicate_commands',
  'context_renewals'
]);

export const CONVERGENCE_ALIASES = Object.freeze({
  final_correction_waves: 'correction_commits',
  context_compactions: 'context_renewals'
});

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
  return config;
}

export function decideConvergence({
  event,
  scope,
  sensitivity,
  reversible,
  authorized,
  metric,
  used,
  limit,
  condition = null,
  enabled = true
}) {
  if (!event) throw new Error('convergence event is required');
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
  else if (condition === 'policy_required_approval' || enabled !== true || reversible !== true) reason = 'policy_required_approval';
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

export function convergenceRecord({ runId, event, scope, sensitivity, decision }) {
  return {
    schema_version: 1,
    id: randomUUID(),
    run_id: runId,
    event,
    outcome: decision.outcome,
    reason: decision.reason,
    scope,
    sensitivity,
    metric: decision.metric,
    used: decision.used,
    limit: decision.limit,
    created_at: new Date().toISOString()
  };
}
