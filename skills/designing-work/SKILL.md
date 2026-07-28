---
name: designing-work
description: Turn an ambiguous or consequential software request into a compact mission contract before implementation.
---

# Designing Work

Use this skill when choices about scope, architecture, behavior, or acceptance
would materially change the implementation. Skip it for exact low-risk edits.

## 1. Inspect before asking

Read the repository instructions, relevant code, tests, architecture notes,
and recent changes. Prefer answering questions from the project over asking
the user to repeat information already present.

Identify:

- the current behavior and authoritative interfaces;
- the requested outcome;
- constraints and explicit exclusions;
- external systems, hardware, migrations, concurrency, or security risks;
- evidence that can and cannot be produced in the current environment.

## 2. Resolve only material ambiguity

Ask a question only when different answers would produce meaningfully
different software. Batch tightly related choices when that reduces delay.
For ordinary implementation details, make the least-surprising reversible
decision and record it.

## 3. Consider approaches

For a consequential design choice, compare two or three viable approaches.
Lead with the recommendation and explain:

- how it fits existing boundaries;
- its failure and rollback behavior;
- testability and observability;
- migration or compatibility impact;
- execution cost and unnecessary machinery avoided.

Do not present fake alternatives that no competent engineer would choose.

## 4. Write the mission contract

For long or multi-file work, create `mission.md` under the Git-local Zimster
runtime directory from `git rev-parse --git-path zimster`:

```markdown
# Mission

## Outcome
One observable sentence.

## Current system
Authoritative components and behavior to preserve.

## Hard constraints
Exact invariants, compatibility floors, exclusions, and required wording.

## Architecture
Chosen approach, ownership boundaries, and data/control flow.

## Failure semantics
What fails, what remains usable, and whether fallback is explicit.

## Acceptance evidence
Automated, integration, external/hardware, and human checks.

## Unavailable proof
Evidence the current environment cannot honestly produce.
```

Keep semantic detail: exact interfaces, invariants, unsupported behavior, and
proof obligations. Remove process boilerplate that a capable coding agent
already understands.

## 5. Approval depth

- For a reversible internal decision, record it and proceed.
- For a public contract, destructive migration, security boundary, major UX
  choice, or expensive external dependency, obtain user approval.
- If the user already approved a design or supplied a binding specification,
  do not reopen it. Check it for contradictions and proceed.

## 6. Self-review

Before implementation, check:

- every requirement has one interpretation;
- failure and fallback behavior are explicit;
- architecture follows existing project boundaries;
- scope exclusions are preserved;
- the acceptance evidence can distinguish success from an untested claim;
- no section is generic ceremony without a decision or constraint.

Then use `writing-plans` for multi-slice work or proceed directly with TDD for
one coherent slice.
