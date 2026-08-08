---
name: designing-work
description: Turn an ambiguous or consequential software request into a compact mission contract before implementation.
---

# Designing Work

Use this skill when choices about scope, architecture, behavior, or acceptance
would materially change the implementation. Skip it for exact low-risk edits.

Choose design depth from the work itself:

- exact, low-risk, well-defined work proceeds without design ceremony;
- material ambiguity or a consequential choice gets compact design;
- a large product, major architecture or UX decision, security or migration
  boundary, public contract, or expensive commitment gets deeper collaborative
  design;
- an oversized multi-system request is decomposed before one bounded workstream
  receives deeper design.

Do not turn this hierarchy into a universal brainstorming gate. Do not require
one question per turn, a committed specification for routine work, or agents
whose only purpose is brainstorming.

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

### Decompose only oversized requests

After inspection, decide whether the request is one complex but coherent system
or multiple substantial, loosely coupled systems with independently meaningful
workstreams. A request touching many files does not by itself require
decomposition, and a well-scoped request should proceed normally.

When one plan would be too broad to stay coherent:

1. identify logical subprojects or bounded workstreams;
2. state their dependencies and recommended order;
3. establish enough shared architecture and constraints to prevent incompatible
   subprojects;
4. preserve the overall mission for later workstreams;
5. select the first useful bounded piece for deeper design.

Decomposition is a design and scoping tool. It does not itself cause delegation
or agent creation. Evaluate any later delegation independently. If the user has
already approved a coherent, binding decomposition, preserve it and do not
reopen it without a material contradiction.

If delegation is a design option, assess its material benefit independently
from model routing. Record the bounded role and why inline ownership is less
appropriate. Do not inspect price, mappings, or catalogs unless delegation is
already selected.

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

### Choose visual treatment per question

For each design question, decide whether seeing the alternatives would be
materially clearer than reading them. UI layouts, architecture topology, state
transitions, data flow, workflow flow, component relationships, and before and
after structure may benefit from lightweight visual treatment when the active
host visual capability is useful.

Use a small diagram, wireframe, side-by-side comparison, or annotated image only
when it improves the decision. Lightweight textual diagram syntax is enough
when the host can render or meaningfully present it. Visual treatment is not
mandatory for UI work.

Requirements clarification, naming decisions, simple implementation trade-offs,
configuration choices, and text-heavy policy decisions normally remain textual.
If no useful visual capability is available, continue textually. Its absence is
not a blocker. Do not require a browser service. Do not require image generation,
and do not imply that Zimster has a dedicated visual companion.

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
