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

Create durable state with installed-package `<zimster>/scripts/init-run.mjs`
when any condition is true. By default it writes to the Git-local path
reported by `git rev-parse --git-path zimster/run.md`, outside product history:

- more than one vertical slice;
- any subagent is dispatched;
- any independent review is required;
- external or hardware evidence is pending;
- more than one commit boundary is expected;
- the work may span compaction;
- a prior session or interrupted run is being resumed.

A Micro task may omit state only when none apply. Keep the record compact:
mission, profile/rationale, branch disposition,
architecture, slice status, evidence IDs, dispatch records, risks, unavailable
proof, and next action. Do not paste full logs or transcripts.

Use `--audit-path <project-relative-documentation-path>` only when the project
has explicitly opted into committed audit evidence. Do not modify tracked
`.gitignore` merely for operational state.

## Delegation and model routing

Use `delegation-record.mjs` first: price/mappings never cause delegation and
`selected: false` forbids routing. A selected role records its inline option,
ownership/tools, cone, stop, and owner proof. Then `model-routing.mjs` may issue
an advisory plan or authoritative dispatch proposal using
`config/model-routing.json`. Resolve
override → run → project → user → harness → inherit; record requested/effective
values and owner acceptance with `<zimster>/scripts/dispatch-record.mjs`; record
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
runs. Record suites, duplicates, agent identities/depth, rechecks,
corrections, context renewals, research, and exposed token thresholds. Crossing
a limit needs a recorded strategy change/invalidation and named proof.

Use `convergence.mjs decide` for ordinary deterministic failure. Continue
without repeated authorization only in-scope, reversible, non-sensitive,
authorized work within budget. Escalate only for contradiction, material
expansion, sensitive authority gaps, missing review, required approval, or
exhaustion. Host permission prompts remain authoritative.

## Logical ownership and phase checkpoints

The logical owner is continuous across renewed physical contexts. At each
vertical-slice boundary, checkpoint only the mission digest, hard invariants,
architecture, slice
commits, valid receipt references, findings, unavailable evidence, exact next
slice/dependency cone, and budget position. Full objectives, passing logs,
diffs, and transcripts remain outside the checkpoint. On continuation, resume
from that checkpoint and reload only the next dependency cone.

## Deterministic verification and evidence reuse

Use `npm run goal:verify` and `npm run release:verify` once available instead of
their constituent commands. Keep full logs in Git-local artifacts and return the
compact receipt summary to the active context. Before repeating a broad
command, check for a valid receipt keyed to the current tree, dirty state,
environment, exact argv, dependency cone, and inputs. Required fresh final
gates are never reused.

The release sequence is build candidate packages → installed-package smoke in
isolated homes → claim-scoped host discovery/smoke → immutable compact review
package → reserved final integration review of the exact final head → bounded correction and
another exact-head review only if required → fresh exact-tree verification →
candidate-completion gate. Correction rechecks never consume the reserved final
review. Source-only review cannot substitute for an available installed
candidate test.

## Capability research and postmortem

Consult the dated capability cache only for the in-scope host. Refresh for
expiry, changed host version/integration, validator contradiction, or explicit
request. The postmortem keeps observed, inferred, and unavailable metrics
distinct and never sums incompatible token meters.

## Harness adaptation

Read only the matching reference:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`
- Cursor/Kimi/OpenCode/Pi: `references/other-harnesses.md`

When subagents are unavailable, execute inline and state that independent
review assurance was unavailable; do not relabel owner-inline work as
`independent_review`.

For self-hosting, freeze accepted policy; candidate rules stay non-authoritative
and isolated until review and acceptance pass.

## Installed version and script-free mode

Read adjacent `references/build-metadata.json` for version, build, source
commit/tree and cleanliness, and package target; never infer these from the
target project's metadata or Git history.

Skills-only installs with no `<zimster>/scripts/` package root continue quietly
while preserving safety, TDD, review, and verification. Mark helper receipts
unavailable and maintain compact state manually.
