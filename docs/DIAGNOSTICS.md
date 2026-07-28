# Diagnostics

Normal Zimster operation is quiet when a harness lacks an optional capability.
The workflow records the selected fallback in Git-local run state and continues
without printing progress warnings. Detailed capability information is
available on demand from a source checkout or portable package:

```text
npm run doctor
npm run doctor -- --json
```

From an installed Codex plugin, resolve the installed plugin root and run:

```text
node <installed-zimster>/scripts/doctor.mjs --json
```

The JSON form is the machine-readable interface. It reports the package target,
installed version, host platform and Node version, version synchronization,
Codex-mirror state, structural package status, harness verification status, and
each capability classification. It writes no warning output on a healthy
package.

Verification failures print a compact `failed_step` and action while preserving
complete stdout/stderr under the Git-local verification log directory. Inspect
that referenced log rather than rerunning the entire profile. Use
`npm run postmortem` to distinguish observed, inferred, and unavailable run
metrics; incompatible token meters are never combined.

Capability-cache status exits 2 when research refresh is required and lists the
specific trigger. That is an actionable research decision, not permission to
refresh every harness contract.

## Quiet fallback

These are expected quiet fallback cases when the capability matrix permits
them:

- named agents are unavailable, so the owner executes inline;
- model or effort selection is not exposed, so execution inherits silently and
  records `unverified`;
- plugin-relative helpers are absent in a skills-only install, so the workflow
  keeps manual state and proof;
- native reviewer isolation is unavailable, so the owner uses the declared
  inline or integrity-guarded fallback;
- a known host loader defect blocks discovery after a package installed
  successfully.

Quiet does not mean invisible. `doctor -- --json`, the run record, and dispatch
or evidence receipts retain the relevant technical state.

## Actionable error

An actionable error stops the required operation. Examples include an invalid
manifest, failed installation, missing required `using-zimster` package
content, corrupted or contradictory evidence, reviewer checkout mutation,
failed test, stale generated Codex mirror, version disagreement, and missing
required verification. Zimster reports the exact file, command, or invariant;
it never converts these failures into a fallback.

## Package diagnostics

Run the checks that match the package:

```text
npm run validate:codex
npm run validate:claude
npm run validate:adapters
npm run sync:codex:check
npm run version:check
```

Harness-specific commands and verification limits are in `CODEX.md`,
`CLAUDE.md`, `CURSOR.md`, `KIMI.md`, `OPENCODE.md`, and `PI.md`.

## Receipts and privacy

Operational state is stored beneath the worktree-specific path returned by
`git rev-parse --git-path zimster`. It is not uploaded or committed by default.
Use `node <zimster>/scripts/evidence.mjs list` to inspect receipts. Pass
`--no-receipt` or set `ZIMSTER_RECEIPTS=off` when local receipt state is not
wanted.
