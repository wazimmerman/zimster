# Migrating from 0.5.0

Zimster 0.6.0 preserves the persistent owner, selective delegation, depth-one
limit, risk-driven review, and semantic completion gate. Model routing does not
increase delegation frequency.

## Compatibility

Dispatch v1 records remain readable in place and are never automatically
rewritten. On read, `fast` maps to `economy`, `standard` maps to `balanced`, and
`expert` remains `expert`; unavailable v2 fields are `legacy_unavailable`.
Legacy execution metrics `final_correction_waves` and `context_compactions` are
read aliases for `correction_commits` and `context_renewals`;
`review_rechecks_per_seam` remains a read alias for `correction_rechecks`.

Existing installations should begin with `routing.mode=inherit` and no concrete
mappings. This preserves 0.5.0 spawn behavior while exposing the new delegation,
proposal, resolution, and requested/effective reporting contracts. Enable
`recommend` first if you want advisory output without changing dispatch.

## Safe rollout

1. Archive the current Git-local run artifacts.
2. Install 0.6.0 in an isolated host home and run exact-package smoke.
3. Validate configuration with `model-routing.mjs validate-config`.
4. Add project or user mappings; Zimster never writes them automatically.
5. Generate adapter overrides to an explicit staging path and inspect them.
6. Enable autonomous convergence only after reviewing the configured budgets.

For emergency workflow rollback, set `routing.mode` to `inherit` and
`autonomous_convergence.enabled` to `false`. Remove generated overrides only
through their ownership manifest, then reinstall the 0.5.0 package/tag. The
0.6.0 code does not mutate historical observations, mappings, or host policy.
