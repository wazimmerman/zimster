---
name: writing-plans
description: Convert an approved mission into a concise vertical-slice implementation plan with explicit risks and proof obligations.
---

# Writing Plans

A plan is an execution contract, not a transcript of how to type code. Preserve
semantic precision while removing procedural repetition.

## Plan around vertical slices

A vertical slice produces observable behavior through the components required
for that behavior. Prefer slices such as “request → validation → persistence →
API response → UI state” over separate “models,” “backend,” and “frontend”
tasks that cannot be judged in isolation.

A slice earns its own boundary when it has:

- an independently observable outcome;
- a distinct risk or interface seam;
- a focused RED-GREEN-REFACTOR cycle;
- evidence that can fail without invalidating every other slice.

Do not multiply tasks because setup, documentation, one type definition, or
one test command can be listed separately.

## Required plan structure

```markdown
# <Feature> Implementation Plan

## Mission and constraints
Link or restate only the binding parts of `.zimster/mission.md`.

## Architecture and ownership
Files/components, authoritative state, and interfaces between them.

## Risk map
Concurrency, security, data loss, external boundaries, compatibility,
performance, accessibility, and unavailable proof.

## Slice 1: <observable result>
- Scope and files
- Interface contracts
- RED proof
- Minimal implementation direction
- GREEN and regression evidence
- Risk trigger and review lens, if any
- Commit boundary

## Slice N...

## Integration and completion gates
Affected suites, full gates, external/hardware/manual evidence, documentation,
and honest completion state.
```

## Detail rules

Include:

- exact names, formats, compatibility floors, state transitions, and error
  behavior;
- interfaces later slices depend on;
- representative test cases and commands when known;
- migration, rollback, cancellation, and cleanup semantics;
- which facts are authoritative and how stale work is rejected;
- proof obligations for claims such as “secure,” “lossless,” or “atomic.”

Avoid:

- repeating generic TDD instructions in every slice;
- complete production code unless an exact algorithm or compatibility contract
  requires it;
- “write tests,” “handle edge cases,” or “add validation” without naming the
  behavior;
- a fresh reviewer gate for every plan heading;
- speculative abstractions and unrelated cleanup.

## Risk triggers

Mark a slice for independent review when it changes an architectural seam or
has medium/high risk in one of these areas:

- concurrency, cancellation, or resource ownership;
- authorization, secrets, or trust boundaries;
- destructive persistence or migration;
- public API/protocol compatibility;
- native OS, hardware, or unstable external services;
- asynchronous UI state authority;
- broad performance or availability impact.

Multiple review lenses normally belong in one review, not one agent each.

## Plan self-review

Check that:

1. slices become usable or testable early;
2. cross-slice interfaces are explicit;
3. the highest-risk seam is exercised before the end;
4. exact constraints appear once and remain reachable by every owner;
5. the plan has no procedural repetition that increases dispatch count without
   increasing evidence;
6. required but unavailable proof is labeled rather than implied.

Save the plan under the repository's preferred documentation location. If no
preference exists, use `docs/zimster/plans/YYYY-MM-DD-<feature>.md`.
