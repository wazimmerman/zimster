# Release checklist

Zimster releases are cut only from a clean, reviewed feature branch after the
complete package set has been exercised. Use the smallest semantic version that
matches the public change. Before 1.0, a new or changed public harness/runtime
contract normally requires a minor bump; a compatible defect correction may
use a patch.

## Prepare metadata

Use the repository mechanism instead of editing versions independently:

```text
npm run version:bump -- <next-version> --note "Release summary"
```

This synchronizes package and lock metadata, all current manifests and
marketplace entries, skills build metadata, changelog, and the generated Codex
mirror.

## Build, install, and review the exact candidate

The default order is:

```text
build candidate packages
→ installed-package smoke in isolated homes
→ available live host discovery and smoke
→ immutable semantic review package
→ final clean-context integration `independent_review`
→ one correction wave and resumed recheck
→ final exact-tree verification
→ requirement/evidence candidate-completion gate
```

The final integration review cannot approve source-only correctness when
installed-package smoke is available. `npm run release:verify` deterministically
orchestrates version checks, packaging, checksums, archive safety, secret scan,
official plugin validation, configured host smoke, and review-package creation.
Installed-package smoke therefore precedes final integration review.

The semantic package binds stable requirement IDs, the requirement-to-evidence
matrix, immutable range, complete change snapshot, relevant unchanged
interfaces, evidence validity and claim scope, unavailable proof, intended
acceptance claims, selected risk lenses, and requested completion state.
Checkout integrity is reported separately from semantic approval.

## Validate the exact tree

Run fresh, after all release edits:

```text
npm run release:verify
npm run check
npm run version:check
npm run version:check -- --tag v<next-version>
npm run assurance -- complete --profile <profile> --owner-verified ...
npm run sync:codex:check
npm run doctor -- --json
npm run checksums
git diff --check
npm run postmortem
```

Also run the current official Codex validator against `plugins/zimster`, then
perform marketplace registration and installation with an isolated
`CODEX_HOME`. Distinguish package validation, installation, fresh-session skill
discovery, and any upstream blocker. When installed, live-smoke the other
harnesses in temporary configuration directories; otherwise record structural
validation as unexecuted live proof.

For the 0.6.0 public beta, exact-package install and fresh-session discovery
receipts are required for Codex, Claude Code, Cursor, Kimi Code, OpenCode, and
Pi. `host-smoke.mjs` reports `BLOCKED_BY_ENVIRONMENT` and exits nonzero when any
required host is absent or unconfigured. Structural validation, historical live
proof, and an extracted archive smoke cannot satisfy this gate. Never emit
`CANDIDATE_COMPLETE` until `all_required` is true for the exact candidate.

## Inspect artifacts

- Confirm the Claude, Codex, and portable ZIPs exist.
- Confirm every archive entry is relative, expected, and free of caches,
  temporary configuration, and Git-local run state.
- Rebuild and compare hashes to prove deterministic packages.
- Verify `dist/SHA256SUMS.txt` covers every archive.
- Run a secret scan over tracked files and archive listings; investigate every
  credential-like match rather than assuming it is safe.
- Validate the version embedded in each package's build metadata.

## Review and Git disposition

Use immutable base/head SHAs for the final integration review. Inspect
`git status --short`, `git diff`, `git diff --cached`, and every untracked file
without staging merely for review. Run the reviewer integrity guard for any
shell-capable probe. Commit documentation and release metadata with real
release changes, never as a standalone approval-bookkeeping commit.

A correction invalidates affected evidence and exact-head approval. Apply at
most the bounded correction wave, refresh the matrix/package for the corrected
head, and resume the same reviewer once. Do not label a release complete when
the gate reports missing evidence or review unavailable.

The tag must exactly match `package.json`; CI reruns `npm run version:check`,
`npm run check`, and `npm run checksums` before publishing artifacts.
