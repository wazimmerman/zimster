---
name: risk-adaptive-review
description: Classify risk deterministically, review complete working-tree changes at architectural seams, and converge with one recheck.
---

# Risk-Adaptive Review

Review follows risk and architectural seams, not plan-heading count.

## Risk dimensions

| Dimension | Low | Medium | High |
|---|---|---|---|
| Blast radius | local unit | subsystem | public/cross-system |
| Concurrency | none | ordinary async | races, cancellation, ownership |
| Security/data | none | recoverable | auth, secrets, destructive change |
| Boundary | internal | stable dependency | hardware, OS, unstable service |
| Novelty | existing pattern | adaptation | new architecture |
| Observability | deterministic | fixture needed | difficult/live-only |

## Profile mapping

| Profile | Deterministic rule | Review |
|---|---|---|
| Micro | All dimensions Low, one coherent slice, no public contract or hard trigger | Owner verification only |
| Standard | One or more Medium dimensions, subsystem/multi-component work, and no High/hard trigger | One review at the concentrated seam or integration point |
| High risk | Any High dimension or hard trigger | Early load-bearing seam review plus final integration review |

Hard triggers include auth/trust, destructive migration, concurrency ownership,
public compatibility, native OS/hardware, unstable service, or live-only proof.
Report the selected profile and rationale.

## Complete review scope

Before any verdict, account for every change—not only tracked unstaged diffs:

```text
git status --short
git diff
git diff --cached
```

Generate `scripts/change-snapshot.mjs --output <path>` so staged, unstaged, and
untracked files are represented without modifying the index. As a manual
fallback, use `git add -N <untracked paths>` followed by `git diff`, or read
every untracked file directly. Restore no index state by guessing; record what
was inspected.

For committed work, include base/head and the complete branch range. For
no-commit work, the change snapshot is the authoritative review package.

## Review lenses

Combine relevant lenses in one review:

- mission/scope compliance;
- state authority and stale work;
- concurrency, cancellation, cleanup;
- security/trust boundaries;
- persistence, migration, rollback;
- API/protocol compatibility;
- error, retry, fallback semantics;
- test falsifiability and edge cases;
- performance/resource limits;
- asynchronous frontend state/accessibility;
- OS, hardware, and external-service truthfulness.

Do not create one reviewer per lens.

## Reviewer roles and tree safety

Use the pure `integration-reviewer` for code/evidence inspection; it has no
Bash. Use the `test-reviewer` only for one named focused experiment. A
test-capable reviewer records before/after working-tree fingerprints and must
report `TREE_INTEGRITY_VIOLATION` if the tree changes. Reviewers never edit the
owner's checkout or recruit agents.

## Inputs

Provide paths to:

- mission/binding requirements;
- slice and selected lenses;
- complete change snapshot or base/head package;
- evidence receipts;
- known unavailable proof;
- requested completion state.

## Initial output

```markdown
## Verdict
APPROVED | NEEDS_CORRECTION | BLOCKED_BY_MISSING_EVIDENCE

## Findings
- [Critical|Important|Minor] file:line — defect, consequence, proof.

## Scope inspected
Branch/range plus staged, unstaged, and untracked coverage.

## Lenses applied
What was checked and why.

## Unverified obligations
Requirements not established here.
```

Critical/Important findings require action. Minor findings are fixed
opportunistically or durably recorded; they do not create a loop.

## Correction and one resumed recheck

The persistent owner fixes the whole Critical/Important batch in one
consolidated correction wave and runs focused covering proof. The same reviewer
performs one resumed recheck over original findings and the fix range only.

## Circuit breaker

If a load-bearing finding remains after the recheck, stop the loop. Choose one
evidence-backed route:

1. reviewer wrong—record technical ruling and proof;
2. contradictory requirement/design—`BLOCKED_BY_REQUIREMENT` or return to owner;
3. real but non-load-bearing—record explicit deferral;
4. real and load-bearing—revise design or stop blocked;
5. evidence unavailable—report the strongest partial state.

Silent dismissal is forbidden.
