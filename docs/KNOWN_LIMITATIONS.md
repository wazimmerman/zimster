# Known limitations

Zimster 0.7.1 is a public beta, not a stable 1.0 compatibility guarantee.

- Host evidence is capability-scoped. Only OpenCode discovery is
  `LIVE_VERIFIED`. Codex and Pi are `INSTALLED_PACKAGE_VERIFIED`; Claude, Grok,
  and Kimi Code are `STRUCTURALLY_VALIDATED` for the named exact-final package
  surfaces. None of those checks establishes model-backed task quality or
  effective model identity.
- Earlier isolated observations on newer Claude, OpenCode, Pi, and Kimi
  versions bind older candidate artifacts and are historical only. They do not
  broaden the exact-final compatibility claim.
- Skills-only installs lack guaranteed scripts, receipts, agents, hooks,
  machine-enforced routing, and mechanical durable-state synchronization. They
  must not claim full runtime recovery/accounting parity; claims that require
  those mechanics remain unavailable. Bundles with the embedded helper runtime
  are exact-package smoked; manually copied or partial skills are not promoted
  to that assurance level.
- A host may accept a requested model without reporting the effective model.
  Strict-cost routing treats that as unverified.
- Model catalogs are account- and session-dependent. Zimster has no canonical
  vendor-model table and safely inherits when evidence is insufficient.
- Optional Pi delegation depends on a separately installed, pinned transport;
  the normal fallback is owner-inline execution.
- Codex plugins do not register agent roles. The shipped role templates require
  an explicit project or personal config copy; generic or managed-Desktop
  spawns without observable role binding cannot satisfy that enforcement claim.
- Where a host does not expose authoritative activity/lineage evidence,
  assurance reconciliation is unavailable. Missing host evidence is never
  treated as proof that no descendant ran.
- The minimum Codex/DeepSWE pilot completed 12 pairs. Its positive point
  estimates are not definitive: the pass-rate confidence interval includes
  zero and Holm-adjusted secondary comparisons are not significant. The
  preferred 48-run campaign remains future work.
- Official OpenAI, Claude, and Grok directory submission remains future work
  and is not part of 0.7.1.

Run `npm run doctor -- --json`, consult `COMPATIBILITY.md`, and bind any broader
claim to a fresh exact-artifact receipt.
