# Known limitations

Zimster 0.7.0 is a release candidate, not a stable 1.0 compatibility guarantee.

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
- Optional Pi delegation depends on a separately installed, pinned transport;
  the normal fallback is owner-inline execution.
- The minimum Codex/DeepSWE pilot completed 12 pairs. Its positive point
  estimates are not definitive: the pass-rate confidence interval includes
  zero and Holm-adjusted secondary comparisons are not significant. The
  preferred 48-run campaign remains future work.
- Public marketplace or registry approval is outside the repository's control.

Run `npm run doctor -- --json`, consult `COMPATIBILITY.md`, and bind any broader
claim to a fresh exact-artifact receipt.
