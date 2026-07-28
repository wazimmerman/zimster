---
name: using-zimster
description: Select the smallest Zimster workflow and risk profile that materially improves a software-development task.
---

# Using Zimster

Zimster preserves disciplined planning, RED-GREEN-REFACTOR, systematic
debugging, independent review, worktree isolation, and evidence-based
completion. One capable agent normally owns coherent implementation from start
to finish.

<SUBAGENT-STOP>
A subagent follows its bounded assignment and named skill. It does not restart
the full workflow or recruit more agents.
</SUBAGENT-STOP>

## Select the smallest workflow

Do not load every skill, create a plan, or dispatch an agent merely because the
mechanism exists.

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

- one coherent vertical slice;
- local blast radius;
- no public compatibility contract;
- no meaningful concurrency, security, destructive data, external service,
  native OS, or hardware boundary;
- deterministic automated proof;
- no independent review is required.

The owner implements, runs focused/affected proofs, and performs fresh final
verification.

### Standard

Use Standard when the change is subsystem-sized, crosses components, or has
one or more Medium dimensions but no High dimension or hard trigger. The owner
implements vertical slices and obtains one seam or integration review where the
medium risk concentrates.

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

## Durable state trigger

Create durable state with plugin-relative `scripts/init-run.mjs` when any
condition is true. By default it writes to the worktree-safe Git-local path
reported by `git rev-parse --git-path zimster/run.md`, outside product history:

- more than one vertical slice;
- any subagent is dispatched;
- any independent review is required;
- external or hardware evidence is pending;
- more than one commit boundary is expected;
- the work may span compaction;
- a prior session or interrupted run is being resumed.

A Micro task may omit durable state only when none of those conditions apply.
Keep the record compact: mission, profile/rationale, branch disposition,
architecture, slice status, evidence IDs, dispatch records, risks, unavailable
proof, and next action. Do not paste full logs or transcripts.

Pass `--harness <codex|claude|cursor|kimi|opencode|pi>` so the run record
contains the selected harness and its machine-readable capability states. When
the harness cannot be identified, omit the option and leave the receipt
explicitly unverified.

Use `--audit-path <project-relative-documentation-path>` only when the project
has explicitly opted into committed audit evidence. Do not modify tracked
`.gitignore` merely for operational state.

## Delegation and model routing

Use `config/model-routing.json` and record each dispatch with
`scripts/dispatch-record.mjs`. Every dispatch names purpose, scope, abstract
model tier, requested model/effort, turn limit, and output contract. Record the
effective model and effort reported by the harness; use `unverified` when the
harness does not expose them. Warn when a fast mechanical role silently
inherits an expensive parent model.

Default limits:

- maximum two parallel implementation agents;
- subagents must not spawn subagents;
- one initial review and one resumed recheck per reviewed seam;
- one consolidated final correction wave.

## Cost controls

Use focused tests during iteration, affected suites at slice boundaries, and
full required gates once on final code. At about 60% of a stated budget, report
the largest consumers. At about 80%, stop optional delegation and polish,
consolidate findings, and prioritize required proof. Never lower a required
quality gate silently.

For Standard and High-risk runs, initialize the machine-readable execution budget
with durable state. Record complete-suite executions, duplicate
commands, optional agent identities, nesting depth, review rechecks, correction
waves, physical context compactions, research refreshes, and exposed token
thresholds. A crossed limit requires a recorded invalidation or strategy
change plus the named proof; it never silently removes required evidence.

## Logical ownership and phase checkpoints

The logical owner is continuous even when the physical context is deliberately
renewed. At each coherent vertical-slice boundary, create a phase checkpoint
containing only the mission digest, hard invariants, architecture, slice
commits, valid receipt references, findings, unavailable evidence, exact next
slice/dependency cone, and budget position. Full objectives, passing logs,
diffs, and transcripts remain outside the checkpoint. On continuation, resume
from that checkpoint and reload only the next dependency cone.

## Deterministic verification and evidence reuse

Once available, use `npm run goal:verify` for goal gates and
`npm run release:verify` for release gates instead of issuing their constituent
commands separately. Keep full logs in Git-local artifacts and return the
compact receipt summary to the active context. Before repeating a broad
command, check for a valid receipt keyed to the current tree, dirty state,
environment, exact argv, dependency cone, and inputs. Required fresh final
gates are never reused.

The release sequence is build candidate packages → installed-package smoke in
isolated homes → available host discovery/smoke → immutable compact review
package → final integration review → one correction/recheck → fresh exact-tree
verification. Source-only review cannot substitute for an available installed
candidate test.

## Capability research and postmortem

Consult the dated, source-linked capability cache for only the host in scope.
Refresh it only for configured expiry, a changed local host version, an
official-validator contradiction, a task that changes that integration, or an
explicit user request for fresh research. Generate the deterministic
postmortem at completion; keep observed, inferred, and unavailable metrics
distinct, and never add incompatible token meters together.

## Harness adaptation

Read only the matching reference:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`
- Cursor/Kimi/OpenCode/Pi: `references/other-harnesses.md`

When subagents are unavailable, execute inline and state that independent
review assurance was unavailable.

## Installed version and script-free mode

Read `references/build-metadata.json` beside this skill to report the installed
semantic version, build identity, source commit when available, and package
target. Do not infer the installed Zimster version from the target project's
package metadata or Git history.

Operational helpers are optional in a skills-only installation. When the
installed skill tree has no plugin-relative `scripts/` directory, continue
inline without a warning: preserve Git safety, TDD, review scope, and fresh
verification. Record that generated receipts are unavailable; maintain the
compact run record manually when durable state is required. Detailed helper
availability belongs in an explicit doctor or diagnostic result, not routine
workflow progress.
