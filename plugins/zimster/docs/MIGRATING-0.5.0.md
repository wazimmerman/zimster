# Migrating from 0.5.0

Zimster 0.6.0 preserves the persistent owner, selective delegation, depth-one
limit, risk-driven review, and semantic completion gate. Model routing does not
increase delegation frequency.

## Compatibility

Dispatch v1 records remain readable in place and are never automatically
rewritten. On read, `fast` maps to `economy`, `standard` maps to `balanced`, and
`expert` remains `expert`; unavailable v2 fields are `legacy_unavailable`.
The legacy execution metric `context_compactions` remains a read alias for
`context_renewals`. Historical final-correction and review-recheck counts are
read from the canonical review lifecycle rather than execution budgets.
`review_rechecks_per_seam` is accepted only as a legacy review-lifecycle alias
for the per-cycle recheck limit; it is not a generic execution budget.

Existing installations should begin with `routing.mode=inherit` and no concrete
mappings. This preserves 0.5.0 spawn behavior while exposing the new delegation,
proposal, resolution, and requested/effective reporting contracts. Enable
`recommend` first if you want advisory output without changing dispatch.

## Safe rollout

1. Archive the current Git-local run artifacts.
2. Install 0.6.0 in an isolated host home and run exact-package smoke.
3. Validate configuration with `model-routing.mjs validate-config`.
4. Add project or user mappings; Zimster never writes them automatically.
5. For `map_only` or `auto_within_policy`, generate adapter overrides to an
   explicit staging path and inspect them; `recommend` and `inherit` do not
   generate enforced overrides.
6. Enable autonomous convergence only after reviewing the configured budgets.

For emergency workflow rollback, set `routing.mode` to `inherit` and
`autonomous_convergence.enabled` to `false`. Remove generated overrides only
through their ownership manifest, then reinstall the 0.5.0 package/tag. The
0.6.0 code does not mutate historical observations, mappings, or host policy.
