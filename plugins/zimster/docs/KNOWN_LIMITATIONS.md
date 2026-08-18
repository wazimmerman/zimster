# Known limitations

Zimster 0.7.2 is a recovery candidate, not a stable 1.0 compatibility
guarantee. The 0.7.0 host observations below are historical until the exact
0.7.2 artifact matrix establishes a replacement claim.

- Host evidence is capability-scoped. Only OpenCode discovery is
  `LIVE_VERIFIED`; Claude and Grok are `STRUCTURALLY_VALIDATED`. None of those
  checks establishes model-backed task quality or effective model identity.
- Codex and Pi are `INSTALLED_PACKAGE_VERIFIED` for the named package behavior.
- Kimi Code is `STRUCTURALLY_VALIDATED` because its CLI was unavailable.
- Skills-only installs lack guaranteed scripts, receipts, agents, hooks, and
  machine-enforced routing.
- A host may accept a requested model without reporting the effective model.
  Strict-cost routing treats that as unverified.
- Model catalogs are account- and session-dependent. Zimster has no canonical
  vendor-model table and safely inherits when evidence is insufficient.
- The current optional Pi transport cannot prove the max-two-active ownership
  boundary mechanically. Zimster therefore fails closed to owner-inline
  execution instead of advertising unenforced parallel delegation.
- The minimum Codex/DeepSWE pilot completed 12 pairs. Its positive point
  estimates are not definitive: the pass-rate confidence interval includes
  zero and Holm-adjusted secondary comparisons are not significant. The
  preferred 48-run campaign remains future work.
- Public marketplace or registry approval is outside the repository's control.
- No host-independent plugin API can forcibly terminate a host autonomy mode.
  Zimster records and reports terminal stop states and refuses another governed
  remediation transition; host-level continuation beyond that point is a host
  enforcement limitation.

Run `npm run doctor -- --json`, consult `COMPATIBILITY.md`, and bind any broader
claim to a fresh exact-artifact receipt.
