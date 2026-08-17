---
name: verification-before-completion
description: Discover canonical project gates and require fresh, correctly classified evidence before any completion claim.
---

# Verification Before Completion

Adapted from Superpowers' evidence-before-claims discipline under the MIT
License.

## Iron law

```text
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before saying done, fixed, passing, ready, or safe:

1. identify the exact requirement;
2. identify the canonical command/observation;
3. run it on the final relevant tree/environment;
4. read complete output, exit status, counts, warnings, skips;
5. map evidence to the requirement;
6. claim only the supported state.

Delegated implementation evidence is incomplete until the persistent owner
has inspected it, run the named acceptance proof, and recorded acceptance.
Requested model settings are not proof of the effective model; report
effective routing as `unverified` when the harness cannot expose it.

## Discover canonical commands first

Resolve `<zimster-runtime>` to the installed `using-zimster` skill root when it
contains scripts/project-commands.mjs, otherwise to the full plugin root when
that script exists there. Never resolve it from the target repository; use the
manual fallback when neither path exists.

Prefer repository-declared commands in this order:

1. repository instructions (`AGENTS.md`, `CLAUDE.md`, contribution docs);
2. package scripts (`package.json`, language manifests);
3. Makefile, task runner, or project scripts;
4. CI workflow commands.

Use `<zimster-runtime>/scripts/project-commands.mjs` as an inventory aid when
available. Prefer `npm test` over an
invented `node --test` command when the repository defines it. Invent direct
commands or flags only when canonical commands cannot establish the required
proof; state why and how the direct command differs.

## Classify command evidence accurately

Do not call every successful process a “full suite.” Distinguish:

- **command failed before discovering tests**: setup/flag/loader failure; zero
  behavioral evidence;
- **command succeeded with zero tests**: valid command, no tests discovered;
- **baseline suite ran with zero tests**: starting-state fact, not a post-change
  passing suite;
- **focused test run**: named subset with exact counts;
- **affected/subsystem suite**: declared scope and counts;
- **full project gate**: canonical project command and exact counts;
- **external/hardware/manual observation**: named environment and result.

A baseline containing zero tests must never be reported as one of several
successful full-suite executions.

## Evidence receipts and reuse

Record commands with `<zimster-runtime>/scripts/evidence.mjs` when available. A receipt binds command, working
-tree fingerprint, Git head/tree, cwd, environment, exit code, test discovery,
counts, scope, and timestamps.

Reuse only valid focused evidence whose fingerprint and dependency cone remain
unchanged. Report reusable duplicates rather than rerunning by habit. Final
completion gates are always run fresh; `--reuse` never satisfies a final claim.
A correction invalidates every proof whose dependency cone includes it.
An ordinary deterministic verification failure continues autonomously within
the final-verification budget when it is in-scope, reversible, non-sensitive,
and authorized. Contradiction, material expansion, sensitive decisions without
authority, missing review, policy-required approval, or exhaustion must stop
and be reported explicitly.

## Verify the complete change

Before review/completion, account for:

```text
git status --short
git diff
git diff --cached
```

Use `<zimster-runtime>/scripts/change-snapshot.mjs` to include all untracked files without
modifying the index, or read every untracked file directly. `git diff` alone is
not a complete review when new files exist.

## Verification ladder

- behavior-specific RED/GREEN proof;
- affected tests/static checks at slice boundary;
- integration tests at component seams;
- canonical full project gates once on final code;
- external service, hardware, and human acceptance only in the actual required
  environment.

## Requirements audit

Give every binding obligation a stable requirement ID. Maintain a
machine-readable requirement-to-evidence matrix containing authoritative
text/source, implementation locations, evidence references, environment or
harness scope, unavailable proof, status, and intended acceptance claims.

Evidence must name the stable requirement IDs it supports, what claims it
establishes, what it explicitly does not establish, and its environment or
harness. Narrow evidence cannot establish a broad compatibility claim. Tests
passing does not prove every requirement.

On a clean final checkout, run the dependency-free gate:

```text
node <zimster-runtime>/scripts/semantic-assurance.mjs complete \
  --profile <micro|standard|high-risk> --owner-verified \
  --requirements <binding.json> --matrix <matrix.json> \
  --evidence <receipts.jsonl> --reviews <reviews.json> \
  --review-package <review-package.json> \
  --review-lifecycle <review-lifecycle.json> \
  --assurance-accounting <assurance-accounting.json> \
  --load-bearing-review-obligations <obligations.json> \
  --execution-budget .git/zimster/budget.json
```

Eligible Micro work may complete owner-only when deterministic eligibility is
supplied with `--micro-eligibility <eligibility.json>`. The record binds the
exact candidate head/tree, all-Low risk dimensions, no public contract or hard
trigger, and nonempty deterministic evidence references. Standard and
High-risk work require `independent_review` for the exact candidate base/head,
review-package ID, stable semantic-contract digest, and required lenses;
High-risk also requires a candidate-bound load-bearing obligation record with
evidence references and final integration review. Every eligibility or
obligation reference must name evidence that explicitly supports the record's
exact requirement ID and exact claim; a fresh receipt for another requirement
or a narrower claim is rejected. Boolean self-attestations are rejected.
Standard and High-risk completion also rejects every pending or unproved
execution-budget override, so override proof must be non-circular and durably
satisfied before completion. Completion accepts only the authoritative
Git-local budget and revalidates every satisfied proof against the current
ledger, invalidations, environment, and exact candidate tree; a copied or
caller-authored budget snapshot is not completion evidence. If review discovers
a circular proof relationship, or a correction makes a satisfied proof stale,
use `run-budget.mjs supersede` to preserve the old receipt and link an
enforceable replacement rather than editing the budget ledger.
Correction rechecks and reserved final-review accounting are separate; the
reserved review applies only after the exact candidate head stops changing.
Owner-inline review is `self_review`. Checkout
integrity (`REVIEW_CHECKOUT_UNCHANGED` or `REVIEW_CHECKOUT_CHANGED`) never
implies semantic approval.

Before Standard or High-risk completion, reconcile supported host observations
with Zimster's dispatch ledger, budget agent identities, and durable typed
review attempts using `assurance-accounting.mjs reconcile`. Missing host
lineage is unavailable evidence, not proof. Any observed agent absent from
dispatch or budget accounting, any missing observed/recorded review attempt,
any lifecycle reviewer absent from observed accounted agents, or descendant
depth above one invalidates the dependent completion claim.

## Honest states

- `CODE_READY`: implementation and automated gates support the code claim;
- `INTEGRATION_VERIFIED`: required components ran together;
- `EXTERNAL_SERVICE_VERIFIED`: named live service tested;
- `HARDWARE_VERIFIED`: exact hardware/parameters tested;
- `HUMAN_ACCEPTANCE_VERIFIED`: named manual acceptance performed;
- `BLOCKED_BY_ENVIRONMENT`: blocked by environment because required proof cannot run here;
- `BLOCKED_BY_REQUIREMENT`: requirements are contradictory, impossible, or lack
  an authoritative decision;
- `OWNER_VERIFIED_REVIEW_UNAVAILABLE`: owner proof exists but required
  independent review could not run;
- `PARTIALLY_VERIFIED`: some obligations remain unproved.
- `CANDIDATE_COMPLETE`: the matrix and profile-appropriate exact-head review
  gate both pass.

Never let automated tests imply service, hardware, or human proof.
Standard and High-risk work without `independent_review` cannot become
`CANDIDATE_COMPLETE`; report unavailable review honestly.

## Report

Include canonical command/observation, code range or fingerprint, environment,
exit status and exact counts, discovery classification, warnings/skips,
requirements established, unavailable proof, completion state, and Git
working-tree disposition. If evidence fails, report the failure and continue
debugging; do not soften it with “should” or “probably.”
