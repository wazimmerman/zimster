---
name: writing-plans
description: Convert an approved mission into a concise vertical-slice plan with risk profile, Git policy, and proof obligations.
---

# Writing Plans

A plan is an execution contract, not a typing transcript. Preserve semantic
precision while removing procedural repetition.

## Plan vertical slices

A vertical slice produces observable behavior through every needed component.
Prefer “request → validation → persistence → API → UI state” over disconnected
model/backend/frontend tasks.

A slice earns a boundary when it has an observable outcome, distinct risk/seam,
focused RED-GREEN-REFACTOR proof, and meaningful commit boundary. Do not split
setup, config, docs, or one type definition into separate task gates.

## Required structure

```markdown
# <Feature> Implementation Plan

## Mission and constraints
Binding requirements only, each with a stable requirement ID.

## Requirement-to-evidence matrix
For every stable requirement ID: authoritative text/source, implementation
locations, evidence references, environment or harness scope, unavailable
proof, status, and intended acceptance claims.

## Profile and rationale
Micro | Standard | High risk, six dimensions, hard triggers.

## Git and durable-state policy
Default/feature branch behavior, worktree need, commit permission/boundaries,
and deterministic Git-local durable-state triggers.

## Architecture and ownership
Files/components, authoritative state, interfaces, cancellation/cleanup.

## Verification commands
Repository-declared canonical focused, affected, integration, and full gates.

## Slice 1: <observable result>
- Scope/files and interface contracts
- Load-bearing behaviors
- Meaningful RED proof for each behavior
- Minimal implementation direction
- GREEN/regression/mutation evidence
- Risk trigger/review lenses
- Commit boundary

## Integration and completion
Complete change review including untracked files, final gates,
external/hardware/manual evidence, documentation, semantic review package,
candidate-completion gate, and honest state.
```

## Profile rules

- Micro: all dimensions Low, one slice, no public contract/hard trigger.
- Standard: one or more Medium dimensions, no High/hard trigger.
- High risk: any High dimension or hard trigger.

State the rationale; do not leave classification to the executing model.

## Detail rules

Include exact names/formats/version floors/state transitions/errors,
interfaces, authoritative facts, stale-work rejection, rollback/cancellation,
representative tests, and proof for claims such as secure/lossless/atomic.
The requirement-to-evidence matrix must preserve each stable requirement ID,
its intended acceptance claims, and the exact environment or harness needed
for proof. Label unavailable proof; do not convert it into an implied claim.

Avoid repeated generic TDD prose, complete production code unless required for
an exact contract, vague “write tests/handle edge cases,” reviewer-per-heading,
speculative abstractions, and unrelated cleanup.

For a multi-behavior new module, do not use one missing-import failure as the
entire RED plan. Specify incremental REDs, an incomplete stub, or focused
mutation checks for each load-bearing behavior.

## Git and review requirements

The plan must say whether direct default-branch work is explicitly disposable,
a feature branch/worktree is required, slice commits are expected, or the user
forbids commits. Delegated implementers commit only when their dispatch grants
ownership in an isolated branch/worktree.

Review packages must include `git status --short`, `git diff`,
`git diff --cached`, and every untracked file through `change-snapshot` or
direct reads.

## Plan self-review

Check:

1. slices become usable/testable early;
2. cross-slice interfaces are explicit;
3. highest-risk seam is exercised early;
4. exact constraints appear once and remain reachable;
5. no procedural repetition multiplies dispatches without evidence;
6. canonical commands and test-discovery expectations are explicit;
7. stable requirement IDs, intended acceptance claims, evidence scope, and
   unavailable proof are represented in the requirement-to-evidence matrix;
8. commit and final working-tree disposition are unambiguous.

Save under repository preference or
`docs/zimster/plans/YYYY-MM-DD-<feature>.md`.
