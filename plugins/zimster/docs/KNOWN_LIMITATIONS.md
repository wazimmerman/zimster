# Known limitations

Zimster 0.6.0 is a public beta, not a stable 1.0 compatibility guarantee.

- Codex package/marketplace installation was previously live-verified, but
  fresh-session plugin skill discovery was blocked; 0.6.0 proof is pending.
- Claude Code, Cursor, Kimi Code, and Pi CLIs are unavailable in the current
  release environment, so their packages are structurally validated rather
  than live-verified.
- OpenCode was live-verified on an earlier version; the current host version
  requires fresh 0.6.0 exact-package proof.
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
- All-six live install and fresh-session discovery receipts are mandatory for
  `CANDIDATE_COMPLETE`. A missing host is `BLOCKED_BY_ENVIRONMENT`, not success.

Use `npm run doctor -- --json` for structural state and `npm run release:verify`
for the exact candidate. Diagnostics hide concrete mapping contents by default.
