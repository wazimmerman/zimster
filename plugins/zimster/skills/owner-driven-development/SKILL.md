---
name: owner-driven-development
description: Execute an approved plan with one persistent implementation owner, explicit Git disposition, bounded delegation, and risk-triggered review.
---

# Owner-Driven Development

The root agent is the persistent implementation owner. It understands the
mission, implements related vertical slices, preserves architectural
invariants, and resolves findings. It is not a passive dispatcher.

## Core loop

```text
profile and Git disposition
→ baseline
→ highest-value vertical slice
→ RED → minimal GREEN → REFACTOR
→ affected evidence
→ risk-triggered seam review
→ next slice
→ final integration review when required
→ one consolidated correction wave
→ fresh completion evidence
→ finishing-a-development-branch
```

## 1. Establish control

Before production edits:

- select Micro, Standard, or High risk and record the rationale;
- read the mission/plan and resolve contradictions;
- inspect repository root, branch, worktrees, status, and project instructions;
- discover repository-declared verification commands;
- record unavailable hardware, service, credential, or human evidence;
- initialize durable state when any deterministic trigger below applies.

If requirements conflict or cannot all be satisfied, stop as
`BLOCKED_BY_REQUIREMENT`; do not disguise it as an environment problem.

## 2. Git lifecycle and commit policy

| Context | Required behavior |
|---|---|
| Disposable/test repo explicitly intended for direct work | Default branch is permitted; do not auto-commit unless requested. |
| Existing project on default branch | Stop before implementation or create a feature branch/worktree, unless the user explicitly authorizes direct work. |
| Existing feature branch or isolated worktree | Commit at verified vertical-slice boundaries by default. |
| User says “do not commit” | Leave changes uncommitted, never stage merely for review, and report disposition exactly. |
| Delegated implementer | It may commit only in its dedicated branch/worktree when the dispatch explicitly grants commit ownership; otherwise it returns a patch or file changes to the owner. |

A commit boundary follows GREEN, affected verification, and any required seam
review for that slice. Never commit unrelated user changes. When commits are
prohibited, record review ranges with a complete change snapshot instead of
inventing commit SHAs.

## 3. Durable state

Create durable state through plugin-relative `scripts/init-run.mjs` when any
condition is true. Normal state belongs at the worktree-safe Git-local path
from `git rev-parse --git-path zimster/run.md`, not in product history:

- more than one vertical slice;
- any subagent is dispatched;
- any independent review is required;
- external or hardware evidence is pending;
- more than one commit boundary is expected;
- work may span compaction;
- a prior session or interrupted run is being resumed.

Record mission, profile/rationale, branch/worktree, commit policy, current
slice, evidence receipt IDs, requested/effective model records, open findings,
unavailable proof, and next action. Keep detailed logs in artifact files.
An audit document inside the project is opt-in through `--audit-path`; do not
commit normal run state or change tracked `.gitignore` for it.

## 4. Keep one owner

The owner normally edits tightly coupled components. Preserve context across
lifecycle, state-authority, migration, and public-contract work. Do not create a
fresh implementer because the plan has another heading.

## 5. Delegate only with an economic case

Valid delegation:

- bounded read-only exploration;
- a genuinely independent implementation workstream with disjoint ownership;
- one targeted consultation for a high-risk question;
- an independent seam/integration reviewer;
- a diagnostician after two owner attempts fail.

Limits:

- maximum of two parallel implementation agents;
- subagents must not spawn subagents;
- every dispatch names purpose, ownership, model tier, requested model and
  effort, turn limit, commit permission, output path, and acceptance proof;
- create a dispatch record before launch and append the effective model and
  effective effort afterward; use `unverified` when the harness cannot report
  them;
- the owner independently verifies returned work.

Pass artifact paths, not accumulated history or full diffs.

## 6. Implement vertical slices with TDD

For each slice:

1. name each load-bearing behavior and its falsifiable proof;
2. observe meaningful RED evidence;
3. implement only enough for GREEN;
4. refactor while focused proofs remain green;
5. run affected repository-declared commands;
6. record evidence receipts and stale dependencies;
7. review the architectural seam when the profile requires it;
8. commit at the verified slice boundary unless commit policy forbids it;
9. update durable state.

Use exploration code only as disposable learning.

## 7. Review seams, not task count

Use one reviewer with several relevant lenses. The normal cycle is:

```text
one complete finding batch
→ owner fixes the Critical/Important batch
→ same reviewer performs one resumed recheck
```

At final integration, use one consolidated correction wave. A remaining
load-bearing defect after the recheck trips the circuit breaker: technically
adjudicate, revise the design, diagnose, or report blocked. Do not keep spawning
reviewers until one approves.

## 8. Evidence ladder and budget

Use focused proofs while editing, affected groups at slice boundaries,
subsystem checks at integration milestones, and required full gates once on the
final tree. Reuse only evidence whose working-tree fingerprint, command,
environment, and dependency cone remain valid. Final completion gates are
always fresh.

At about 60% of budget, report owner turns, agent starts, review waves, duplicate
commands, and resident context. At about 80%, stop optional work and prioritize
required proof.

## 9. Completion

Supported states include `CODE_READY`, `INTEGRATION_VERIFIED`,
`EXTERNAL_SERVICE_VERIFIED`, `HARDWARE_VERIFIED`,
`HUMAN_ACCEPTANCE_VERIFIED`, `BLOCKED_BY_ENVIRONMENT`,
`BLOCKED_BY_REQUIREMENT`, and `PARTIALLY_VERIFIED`.

Always invoke `verification-before-completion`, then
`finishing-a-development-branch`. The final report must state branch, commits,
staged files, unstaged files, untracked files, and whether work remains
uncommitted.
