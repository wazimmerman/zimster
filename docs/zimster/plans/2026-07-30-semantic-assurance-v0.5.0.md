# Zimster 0.5.0 Semantic Assurance Implementation Plan

## Mission and constraints

### Outcome

Zimster must distinguish implementation, owner verification, independent
semantic approval, evidence coverage, and checkout integrity so that
`CANDIDATE_COMPLETE` is emitted only for proof-bounded work.

### Binding requirements

- **ASSURANCE-001:** Represent `self_review` and `independent_review`; an
  owner-inline review is always self-review and cannot satisfy Standard or
  High-risk independent-review obligations.
- **ASSURANCE-002:** Independent review records identify immutable base/head
  SHAs, reviewer or dispatch identity, clean bounded context, reviewed
  requirements and claims, semantic lenses, verdict, findings, unverified
  obligations, timestamp, review-package identity, and checkout integrity.
- **ASSURANCE-003:** Preserve distinct states for implementation complete,
  owner verified, review pending, semantic review approved, owner verified
  with review unavailable, partially verified, candidate complete, and blocked
  by missing evidence.
- **GATE-001:** Micro work may complete owner-only only under its existing
  deterministic eligibility rules; Standard and High-risk work require an
  approved clean-context independent review for the exact candidate head.
- **GATE-002:** High-risk candidate completion additionally requires all
  load-bearing review obligations and a final independent integration review.
- **GATE-003:** Review-unavailable work may finish only in an honest partial
  state and must not imply readiness, compatibility, acceptance, or
  independent approval.
- **INTEGRITY-001:** Replace checkout-integrity approval-like results with
  `REVIEW_CHECKOUT_UNCHANGED` and `REVIEW_CHECKOUT_CHANGED` (or semantically
  identical names); checkout integrity never implies semantic approval.
- **MATRIX-001:** Add a dependency-free local schema and Node tool for a
  machine-readable requirement-to-evidence matrix with stable unique IDs,
  authoritative text/source, implementation locations, evidence references
  and scope, unavailable proof, required states, and intended claims.
- **MATRIX-002:** Validate complete binding-requirement coverage, evidence
  existence/freshness/tree and environment applicability, claim scope, and
  unresolved obligations that block candidate completion.
- **EVIDENCE-001:** Evidence receipts or named observations identify supported
  requirement IDs, established claims, explicitly excluded claims, and
  environment or harness scope.
- **CLAIM-001:** Completion claims are derived from the matrix; evidence cannot
  establish a broader claim than its explicit scope and unsupported claims
  become unverified obligations.
- **REVIEW-001:** The compact semantic review package includes the approved
  mission, stable IDs, matrix, immutable range, authoritative snapshot,
  relevant unchanged interfaces, evidence and invalidation state, unavailable
  proof, intended claims, selected lenses, and requested state.
- **REVIEW-002:** Review output distinguishes semantic approval, correction,
  missing evidence, self-review only, and checkout integrity, and directs the
  reviewer to falsify intended claims.
- **LENS-001:** Deterministically select a framework-defaults/conventions lens
  for convention-heavy frameworks and cover implicit matching, defaults,
  precedence, alternate locations, inheritance, working-directory assumptions,
  generated/user topology, and dynamic discovery.
- **LENS-002:** Deterministically select a shared-control-flow lens when common
  code branches to specialized adapters/providers and cover bypass, ordering,
  cleanup, validation, fallback, and contract-suppression risks.
- **CORRECTION-001:** A correction invalidates affected evidence and prior
  approval; only one consolidated correction wave and one scoped recheck by
  the same reviewer are permitted.
- **REGRESSION-001:** Behavioral tests cover all mission scenarios while
  preserving existing Micro, Standard, High-risk, TDD, review, packaging,
  evidence, budget, and postmortem behavior.
- **SYNC-001:** Canonical sources remain authoritative and the generated Codex
  plugin remains deterministically synchronized.
- **VERSION-001:** Prepare release metadata and relevant public documentation
  for 0.5.0 through the repository version mechanism.
- **VERIFY-001:** Build and smoke the exact installable candidate, perform one
  clean-context independent integration review, and run the canonical final
  release verification once on the exact final tree.
- **ECONOMY-001:** Preserve one persistent implementation owner, no
  implementation subagents or nested delegation, one reviewer, one finding
  batch, at most one correction wave/recheck, Git-local operational records,
  dependency-free runtime tooling, archive/secret/cross-platform controls, and
  no push, merge, PR, tag, publish, new branch/worktree, or global host changes.

### Current system

`scripts/evidence.mjs` owns evidence receipts, `scripts/review-package.mjs`
builds immutable review inputs, `scripts/review-integrity.mjs` detects reviewer
checkout mutations, and canonical skills define workflow policy. The Codex
plugin under `plugins/zimster/` is generated from canonical sources.

### Architecture

Add a pure semantic-assurance library for schemas, record validation, matrix
evaluation, lens selection, and completion-state derivation. Thin CLI helpers
will read Git-local JSON records, produce machine-readable decisions plus a
concise human summary, and extend existing evidence/review-package tools.
Schemas are public contracts; normal run matrices and reviews remain under
`git rev-parse --git-path zimster`.

### Failure semantics

Invalid records fail closed with actionable diagnostics. Missing or narrow
proof yields a partial/missing-evidence state. Missing independent review
yields review-pending or review-unavailable, never candidate completion.
Checkout changes are reported independently of the semantic verdict.

### Unavailable proof

No live external service or hardware proof is required. Independent review is
available through one clean-context Codex reviewer; read-only tool enforcement
is unavailable, so checkout-integrity capture/verify must bound any
shell-capable review.

## Profile and rationale

**High risk.** Blast radius and novelty are High because this changes Zimster's
public completion and compatibility contract. Boundary and observability are
Medium because Git state, installed packages, and review context must align.
Concurrency and security/data are Low. Public compatibility is a hard trigger.

## Git and durable-state policy

Stay on `feat/semantic-assurance-v0.5.0` in the existing worktree. Use Git-local
run state, matrix, review records, receipts, snapshots, and checkpoints. Create
one verified commit for each of four slices and at most one correction commit.
Do not push, merge, create a pull request, tag, publish, branch, or create
another worktree.

## Architecture and ownership

The root owner changes the canonical `scripts/`, `schemas/`, tests, skills, and
docs. `scripts/lib/semantic-assurance.mjs` is the harness-neutral policy core.
CLI and package tools remain dependency-free. The Codex mirror is regenerated
only after canonical integration changes are complete.

## Verification commands

Use focused `node --test <named files>` runs during RED/GREEN, affected tests at
slice boundaries, `npm run sync:codex:check` after synchronization, and the
repository final commands exactly once on the final tree:
`npm run release:verify -- --tag v0.5.0`, `npm run check`,
`npm run version:check`, `npm run version:check -- --tag v0.5.0`,
`npm run sync:codex:check`, and `git diff --check`.

## Slice 1: assurance types and checkout-integrity truth

- Add review/state contracts and behavior-specific tests proving self-review
  cannot satisfy independent obligations.
- Rename integrity success/failure output and prove unchanged checkout is not a
  semantic verdict.
- Run focused assurance/integrity tests and affected validation.
- Review lenses: public contract, state authority, compatibility.
- Commit boundary: assurance model plus integrity status.

## Slice 2: requirement/evidence matrix and claim bounding

- Add schemas and pure validation for binding sets, matrix entries, evidence
  freshness/scope, and exact claim support.
- Extend evidence receipts with requirement IDs, established/excluded claims,
  and environment/harness scope.
- Prove missing requirements, stale evidence, and narrow evidence block the
  affected acceptance claim.
- Commit boundary: valid machine-readable coverage and scoped evidence.

## Slice 3: review package, risk lenses, and completion gate

- Extend review packages and review records with all semantic inputs.
- Select framework-defaults and shared-control-flow lenses only from relevant
  risk triggers.
- Add a deterministic completion command covering Micro, Standard, High-risk,
  unavailable review, older-head approval, and correction invalidation.
- Commit boundary: semantic completion evaluation and review integration.

## Slice 4: integration, documentation, mirror, and version

- Update canonical workflow skills, reviewer contract, architecture,
  operations, release/evaluation docs, README, schemas/templates, and package
  validation.
- Run `npm run version:bump -- 0.5.0 --note "Enforce semantic assurance and requirement-to-evidence completion gates"`.
- Regenerate and check `plugins/zimster`, then run affected integration,
  packaging, evidence, execution-budget, and postmortem tests.
- Commit boundary: synchronized 0.5.0 candidate.

## Integration and completion

Account for status, staged, unstaged, and every untracked file. Build the exact
candidate and installed-package smoke before review. Produce an immutable
semantic review package and dispatch one clean-context reviewer to falsify all
intended acceptance claims. If required, apply one consolidated correction
commit and request one scoped recheck from the same reviewer. Run fresh final
verification on the exact final tree and report only the state supported by
the completion gate.
