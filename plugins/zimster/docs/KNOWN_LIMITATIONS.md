# Known limitations

Zimster 0.6.0 is a public beta, not a stable 1.0 compatibility guarantee.

- Codex exact-package installation and manifest validation are
  `INSTALLED_PACKAGE_VERIFIED`; fresh-session plugin skill discovery remains
  unverified for 0.6.0.
- Claude Code, Cursor, Kimi Code, and Pi CLIs are unavailable in the current
  release environment, so their packages are structurally validated rather
  than live-verified.
- OpenCode exact-package skill discovery is `LIVE_VERIFIED`; this does not claim
  model-backed task execution or effective-model identity.
- A host may accept a requested model without reporting the effective model.
  That remains `unverified`, and strict-cost routing cannot treat it as proof.
- Cursor concrete model fields and Kimi secondary routing are experimental or
  version-gated. Pi ships no Zimster subagent runtime.
- Model catalogs are account/session dependent and may be unavailable. Zimster
  has no canonical vendor-model table and safely inherits when evidence is
  insufficient.
- Skills-only installs preserve workflow guidance but may lack scripts,
  receipts, adapter generation, and machine-enforced routing.
- Generated overrides deliberately refuse user-owned collisions, changed
  generated files, and symlink targets; manual reconciliation is required.
- Public-beta completion requires one exact-package `LIVE_VERIFIED` host and
  claim-bounded receipts for all six harnesses. Stable completion may require
  stronger multi-host live coverage. Missing optional public-beta hosts are
  classified explicitly and narrow their support claims.

Use `npm run doctor -- --json` for structural state and `npm run release:verify`
for the exact candidate. Diagnostics hide concrete mapping contents by default.
