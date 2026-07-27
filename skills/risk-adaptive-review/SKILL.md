---
name: risk-adaptive-review
description: Apply independent review at risky architectural seams and converge with one correction wave and one recheck.
---

# Risk-Adaptive Review

Review effort follows risk and architectural seams, not the number of plan
headings. A small mechanical diff may need owner verification only. A
cross-component lifecycle change may need review before later slices build on
it.

## Risk classification

Assess the change across these dimensions:

| Dimension | Low | Medium | High |
|---|---|---|---|
| Blast radius | local unit | subsystem | public/cross-system |
| Concurrency | none | ordinary async | races, cancellation, ownership |
| Security/data | none | recoverable | auth, secrets, destructive change |
| Boundary | internal | stable dependency | hardware, OS, unstable service |
| Novelty | existing pattern | adaptation | new architecture |
| Observability | deterministic | fixture needed | difficult/live-only |

One high dimension or several medium dimensions justify an independent review.
Review early when downstream work depends on the seam.

## Review lenses

Choose the relevant lenses and combine them in one review:

- mission and scope compliance;
- state authority and stale work;
- concurrency, cancellation, and cleanup;
- security and trust boundaries;
- persistence, migration, and rollback;
- API/protocol compatibility;
- error, retry, and fallback semantics;
- test falsifiability and missing edge cases;
- performance and resource limits;
- frontend asynchronous state and accessibility;
- native OS, hardware, and external-service truthfulness.

Do not create one reviewer per lens. A reviewer applies the selected lenses to
one coherent seam or integration range.

## Inputs

Provide paths rather than pasted artifacts:

- mission or binding requirements;
- plan slice and selected review lenses;
- base and head range or a generated diff package;
- focused evidence ledger;
- known unavailable proof.

The reviewer is read-only. It verifies claims against code and evidence, does
not rewrite the implementation, and does not re-run expensive suites unless a
specific doubt requires a focused experiment.

## Initial review output

Return one complete finding batch:

```markdown
## Verdict
APPROVED | NEEDS_CORRECTION | BLOCKED_BY_MISSING_EVIDENCE

## Findings
- [Critical|Important|Minor] file:line — defect, consequence, and proof.

## Lenses applied
What was checked and why.

## Unverified obligations
Requirements not established by this code range or environment.
```

Critical and Important findings require action. Minor findings are either
fixed opportunistically or recorded for final triage; they do not create their
own review loop.

## Correction and recheck

The persistent owner fixes the complete Critical/Important batch in one
consolidated correction wave and runs focused covering tests.

The same reviewer performs one resumed recheck over the fix range. It verdicts
each original finding and checks only for breakage introduced by the fix.
This is one resumed recheck, not a new broad review.

## Circuit breaker

If a load-bearing finding remains after the recheck, trip the circuit breaker.
Do not start an unbounded sequence of fresh reviewers and fixes.

The owner must choose one evidence-backed route:

1. reviewer is wrong—record the technical ruling and proof;
2. requirement or design is contradictory—return to the mission owner;
3. defect is real but not load-bearing—record explicit deferral;
4. defect is real and load-bearing—stop as blocked or revise the design;
5. evidence is unavailable—report the strongest partial completion state.

Every ruling is durable. Silent dismissal is forbidden.

## Final integration review

For medium/high-risk features, use one fresh integration reviewer after all
slices compose. Review the whole change against the mission, with emphasis on
cross-slice lifecycle and state authority. If findings exist, use one
consolidated correction wave and one resumed recheck.
