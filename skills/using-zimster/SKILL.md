---
name: using-zimster
description: Select the smallest Zimster workflow and risk profile that materially improves a software-development task.
---

# Using Zimster

One capable agent normally owns planning, implementation, RED-GREEN-REFACTOR,
debugging, independent review, worktree isolation, and evidence-based completion.

<SUBAGENT-STOP>
A subagent follows its bounded assignment and named skill. It does not restart
the full workflow or recruit more agents.
</SUBAGENT-STOP>

## Select the smallest workflow

Do not load every skill; plan or dispatch only when it materially helps.

| Situation | Load |
|---|---|
| Exact low-risk behavior change | `test-driven-development`, then verification |
| Bug or unexplained failure | `systematic-debugging`, then TDD |
| Multi-file change with consequential choices | `designing-work`, then `writing-plans` |
| Approved plan or coherent implementation request | `owner-driven-development` |
| Two genuinely independent workstreams | `dispatching-parallel-agents` |
| Reviewed seam or integration range | `risk-adaptive-review` |
| Branch completion or handoff | `finishing-a-development-branch` |

User and repository instructions override Zimster defaults.

## Deterministic execution profile

Classify the six dimensions in `risk-adaptive-review`, then select one profile.
Always report the selected profile and its risk rationale before implementation.

### Micro

Use Micro only when all dimensions are Low and all of these are true:

- single coherent slice;
- local blast radius;
- no public compatibility contract;
- no meaningful concurrency, security, destructive-data, external-service,
  native-OS, or hardware boundary;
- deterministic automated proof;
- no independent review.

The owner implements, runs focused/affected proofs, and performs fresh final
verification.

### Standard

Use Standard for subsystem or cross-component work with Medium dimensions but
no High dimension or hard trigger. The owner implements vertical slices and
reviews the concentrated seam or integration.

### High risk

Use High risk when any dimension is High or any hard trigger exists:

- authentication, authorization, secrets, or trust boundaries;
- destructive data change, migration, or rollback risk;
- races, cancellation, lock ordering, or resource ownership;
- public API/protocol compatibility;
- native OS, hardware, unstable external service, or live-only evidence;
- new architecture with broad blast radius.

The owner consults at most one targeted specialist when useful, reviews the
load-bearing seam early, and obtains one final integration review.

## Semantic assurance contract

Keep four facts separate:

- checkout integrity (`REVIEW_CHECKOUT_UNCHANGED` or
  `REVIEW_CHECKOUT_CHANGED`) says only whether the reviewer-visible checkout
  changed; neither status implies semantic approval;
- evidence validity says whether a receipt applies to its tree, dependency
  cone, environment, and claim;
- `self_review` is the owner's inline inspection;
- `independent_review` is clean bounded-context falsification of candidate
  claims.

Owner-inline review is always `self_review` and cannot satisfy Standard or
High-risk independent review. Micro owner-only needs deterministic eligibility
and a passing requirement matrix. Standard and High-risk need approved
`independent_review` for the exact candidate head; High-risk also needs every
load-bearing obligation and final integration review. If unavailable, report
`OWNER_VERIFIED_REVIEW_UNAVAILABLE` or another honest partial state, never
readiness. Only the deterministic completion gate may emit `CANDIDATE_COMPLETE`.

## Durable state trigger

Resolve `<zimster-runtime>` from installed `using-zimster` when it has
scripts/init-run.mjs, else the full plugin root. Never use target repo; fall
back manually if absent.

Create state with `<zimster-runtime>/scripts/init-run.mjs`
when any condition is true. By default it writes canonical machine state and a
derived view beneath the Git-local path reported by
`git rev-parse --git-path zimster`, outside product history:

- more than one vertical slice;
- any subagent is dispatched;
- any independent review is required;
- external or hardware evidence is pending;
- more than one commit boundary is expected;
- the work may span compaction;
- a prior session or interrupted run is being resumed.

A Micro task may omit state only when none apply. Use `run-control.mjs start`
before substantial slice implementation. Keep current and next slices distinct;
checkpoint meaningful dirty progress, failures/corrections, evidence/review/
budget transitions, and intentional renewal. `resume` reconciles actual Git
state and must preserve touched files, obligations, compact failure, guards,
receipt validity, and exact next action/command. Do not paste full logs or
transcripts.

`run.md` is a deterministic derived view, never an independent source. Use
`run-control.mjs check` to detect `STALE_RUN_SUMMARY` and `refresh` to repair it.
Treat `RECOVERY_RECONCILIATION_REQUIRED` as ambiguity requiring explicit owner
reconciliation, not permission to invent an unstarted slice.

Use `--audit-path <project-relative-documentation-path>` only when the project
has explicitly opted into committed audit evidence. Do not modify tracked
`.gitignore` merely for operational state.

## Delegation and model routing

Use `<zimster-runtime>/scripts/delegation-record.mjs` first: price/mappings never delegate and
`selected: false` forbids routing. Selected roles record inline option,
ownership/tools, cone, stop, and owner proof. Then
`<zimster-runtime>/scripts/model-routing.mjs` may issue
an advisory plan or authoritative dispatch proposal using
`config/model-routing.json`. Resolve
override → run → project → user → harness → inherit; record requested/effective
values and owner acceptance with `<zimster-runtime>/scripts/dispatch-record.mjs`; record
the same fields manually when unavailable. Classes are
economy, balanced, expert, and inherit
without vendor defaults; unknown values stay `unverified` and old tiers alias.

Default limits:

- maximum two parallel implementation agents;
- model routing does not increase the default frequency of delegation;
- subagents must not spawn subagents;
- one initial review and one resumed recheck per reviewed seam;
- correction commits/rechecks use their bounded accounting;
- an exact-final-head integration review remains separately reserved until the
  candidate stops changing.

## Cost controls

Use focused tests while iterating, affected suites at slice boundaries, and
full required gates once. Around 60% of a stated budget, report its largest
consumers. Around 80%, stop optional work and prioritize required proof.
Never lower a required quality gate silently.

Initialize the machine-readable execution budget for Standard and High-risk
runs. Run verification through `verify.mjs` and commands through
`evidence.mjs run` so a durable governed-execution start exists before the
process spawns. Suite and exact-duplicate counts are derived from those
execution identities; use `accounting-reconcile.mjs check` before dependent
claims and audited `reconcile` to repair a mismatch. Direct shell executions
remain mechanically unobservable and must not be claimed as counted. Record
agent identities/depth, rechecks, corrections, context renewals, research, and
exposed token thresholds. Crossing a limit needs a recorded strategy
change/invalidation and named proof.

A budget proof must be a pre-existing passing governed verification/evidence
receipt. Its terminal bytes must authenticate against the execution receipt,
and its candidate, environment, runtime provenance, issuer, governing-policy
role, and required relationship must match. A receipt created after the
override is circular and cannot satisfy that override; manual `evidence record`
receipts are never budget proofs.

Use `<zimster-runtime>/scripts/convergence.mjs decide` for ordinary deterministic failure. Continue
without repeated authorization only in-scope, reversible, non-sensitive,
authorized work within budget. Escalate only for contradiction, material
expansion, sensitive authority gaps, missing review, required approval, or
exhaustion. Host permission prompts remain authoritative.

## Logical ownership and phase checkpoints

The logical owner is continuous across renewed physical contexts. Persist slice
start before implementation. At material milestones and each vertical-slice
boundary, checkpoint the compact current execution cone: base and actual Git
state, touched files, obligations, verification/failure, corrections,
valid/stale/unavailable receipts, findings, review/budget position, guards, and
exact continuation. Full objectives, passing logs, diffs, and transcripts remain
outside the checkpoint. On continuation, resume the current interrupted
execution before loading later slices.

## Deterministic verification and evidence reuse

Use `npm run goal:verify` and `npm run release:verify` once available instead of
their constituent commands. Keep full logs in Git-local artifacts and return the
compact receipt summary to the active context. Before repeating a broad
command, check for a valid receipt keyed to the current tree, dirty state,
environment, exact argv, dependency cone, and inputs. Required fresh final
gates are never reused.

Release sequence: build packages → installed-package smoke → host smoke →
review package → reserved exact-head final integration review → bounded
correction/review if needed → fresh exact-tree verification → completion gate.
Source-only review never replaces available installed-package proof.

## Capability research and postmortem

Consult the dated capability cache only for the in-scope host. Refresh for
expiry, changed host version/integration, validator contradiction, or explicit
request. The postmortem keeps observed, inferred, and unavailable metrics
distinct and never sums incompatible token meters.

## Harness adaptation

Read only the matching reference:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`
- Grok/Cursor/Kimi/OpenCode/Pi: `references/other-harnesses.md`

When subagents are unavailable, execute inline and state that independent
review assurance was unavailable; do not relabel owner-inline work as
`independent_review`.

For self-hosting, freeze accepted policy; candidate rules stay non-authoritative
and isolated until review and acceptance pass.

## Installed version and script-free mode

Read adjacent `references/build-metadata.json` for version, build, source
commit/tree and cleanliness, and package target; never infer these from the
target project's metadata or Git history.

Without scripts, continue quietly: preserve safety, TDD, review, and
verification; mark helper receipts unavailable and maintain compact state
manually. Do not warn.
