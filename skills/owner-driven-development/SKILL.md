---
name: owner-driven-development
description: Execute an approved plan with one persistent implementation owner, bounded delegation, and risk-triggered review.
---

# Owner-Driven Development

The root agent is the persistent implementation owner. It understands the
whole mission, implements related vertical slices, preserves architectural
invariants, and resolves findings. It is not a passive dispatcher.

## Core loop

```text
mission and baseline
→ highest-value vertical slice
→ RED
→ minimal GREEN
→ REFACTOR
→ focused verification
→ risk-triggered seam review when warranted
→ next slice
→ integration review
→ one consolidated correction wave
→ fresh completion evidence
```

## 1. Establish control

- Confirm an isolated branch or worktree.
- Read the mission and plan once; resolve contradictions before coding.
- Run the smallest baseline that proves the starting state.
- Create `.zimster/run.md` for long work.
- Record unavailable hardware, service, credential, or human evidence now.

## 2. Keep one owner

The persistent owner normally edits all tightly coupled components. Preserve
context across slices, especially for lifecycle, state authority, migrations,
and public contracts.

Do not dispatch a fresh implementer merely because the plan has another
heading. Context isolation is useful for independent judgment and noisy
research; repeated cold implementation contexts are a cost and coherence risk.

## 3. Delegate only with an economic case

Valid delegation:

- bounded read-only exploration whose findings can be summarized;
- a genuinely independent implementation workstream with disjoint ownership;
- one targeted consultation for an unusually technical or high-risk question;
- an independent integration reviewer;
- a diagnostician after the owner fails to resolve the same defect twice.

Default limits:

- a maximum of two parallel implementation agents;
- subagents must not spawn subagents;
- every agent has a named purpose, file or question boundary, model tier,
  turn limit, and output contract;
- the owner verifies every returned change before accepting it.

Pass artifacts by path. Do not paste accumulated history or full diffs into
later prompts.

## 4. Implement vertical slices with TDD

For each slice:

1. state the behavior and proof that will fail;
2. write and run the focused test or reproduction;
3. confirm RED failed for the expected reason;
4. implement only what is required for GREEN;
5. run the focused proof;
6. refactor while keeping the proof green;
7. run affected tests at the slice boundary;
8. update the run ledger with evidence, risks, and next action.

Use exploration code only as disposable learning. Production behavior follows
the test-first cycle unless the user approved a documented exception.

## 5. Review seams, not task count

Load `risk-adaptive-review` when a slice crosses a marked seam or when a final
independent perspective is warranted. One reviewer may apply several relevant
review lenses.

The normal correction cycle is:

```text
one complete finding batch
→ owner fixes the batch
→ same reviewer performs one resumed recheck
```

At final integration, use one consolidated correction wave—not one fixer per
finding. A remaining load-bearing defect after the recheck trips the circuit
breaker: diagnose, revise the design, or report blocked. Do not keep spawning
fresh reviewers until one happens to approve.

## 6. Verification ladder

- During edits: focused test or reproduction.
- At slice completion: affected test group and static checks relevant to the
  touched code.
- At an integration milestone: subsystem suite.
- Before completion: every required full gate once on the final code.
- After a cross-cutting final correction: rerun affected proofs and any full
  gate invalidated by that change.

Cache evidence by code range, command, and environment. Reuse still-valid
focused evidence; never reuse stale final evidence for a completion claim.

## 7. Budget adaptation

At roughly 60% of the run budget, report the largest consumers: owner turns,
agent starts, review waves, repeated commands, or resident context. At roughly
80%, stop optional delegation and polish, combine remaining findings, and
prioritize required proof.

A budget is a strategy constraint, not permission to falsify completion.

## 8. Completion states

Report the strongest state supported by evidence:

- `CODE_READY`
- `INTEGRATION_VERIFIED`
- `EXTERNAL_SERVICE_VERIFIED`
- `HARDWARE_VERIFIED`
- `HUMAN_ACCEPTANCE_VERIFIED`
- `BLOCKED_BY_ENVIRONMENT`
- `PARTIALLY_VERIFIED`

A passing automated suite does not imply unavailable hardware or human
acceptance. Use `verification-before-completion`, then
`finishing-a-development-branch`.
