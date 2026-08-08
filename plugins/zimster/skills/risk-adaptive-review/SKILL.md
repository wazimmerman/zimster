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
| Standard | One or more Medium dimensions, subsystem/multi-component work, and no High/hard trigger | Clean-context `independent_review` at the concentrated seam or integration point |
| High risk | Any High dimension or hard trigger | Early load-bearing review plus final clean-context integration `independent_review` |

Hard triggers include auth/trust, destructive migration, concurrency ownership,
public compatibility, native OS/hardware, unstable service, or live-only proof.
Report the selected profile and rationale.

Owner-inline inspection is `self_review`; it cannot satisfy Standard or
High-risk `independent_review`. Approval applies only to the exact candidate
base/head, review-package ID, stable semantic-contract digest, and required
lens set. The digest covers binding text, intended claims, implementation
locations, and evidence scope, but excludes mutable evidence references,
statuses, observations, and verification results. Final evidence may advance
without invalidating approval when that contract and the candidate are
unchanged.
If review is unavailable, use `OWNER_VERIFIED_REVIEW_UNAVAILABLE`, never
approval. `CANDIDATE_COMPLETE` requires the profile-appropriate semantic
approval and complete matrix evidence. High-risk work requires all
load-bearing obligations and final integration approval.

## Complete review scope

Before any verdict, account for every change, not only tracked unstaged diffs:

```text
git status --short
git diff
git diff --cached
```

Generate `<zimster>/scripts/change-snapshot.mjs --output <path>`, resolved from
the installed package root, so staged, unstaged, and
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
- `framework-defaults-and-conventions` for inherited project configuration,
  build tools, wrappers/adapters, configuration loaders, CLI frameworks,
  routers, ORMs, plugin systems, or generated/user-managed topology that change
  discovery, precedence, abbreviation, dynamic behavior, or defaults. Check
  default and alternate locations, inherited and explicit configuration,
  precedence, abbreviations, dynamic behavior, and invocation from a different
  working directory;
- `shared-control-flow` when a shared adapter, provider, platform, or backend
  branches from common to specialized behavior and could bypass shared
  validation, cleanup, error handling, or state updates. Check early return
  bypasses, specialized setup ordering, fallback masking of errors, and
  specialized-contract suppression by common defaults or cleanup.

Do not create one reviewer per lens.

## Reviewer roles, types, and checkout safety

Use the pure `integration-reviewer` for code/evidence inspection; it has no
Bash. Use the `test-reviewer` only for one named focused experiment. A
test-capable reviewer must run plugin-relative `review-integrity.mjs capture`
with immutable base/head SHAs and `--review-files` naming the mission,
snapshot, evidence ledger, and other binding inputs before its command, then
run `review-integrity.mjs verify` afterward. It reports
`REVIEW_CHECKOUT_CHANGED` if HEAD, index, tracked, untracked, or review-package
files change and `REVIEW_CHECKOUT_UNCHANGED` otherwise. Checkout integrity does
not imply semantic approval. Review inputs may be explicit absolute paths outside the
worktree, including attachments and Git-local receipts. A shell-capable,
prompt-constrained Codex reviewer always uses this guard. Reviewers never edit
the owner's checkout or recruit agents.

Record the risk-driven need for independent review before selecting its model.
Strict-cost routing that cannot prove enforcement reports review unavailable
and requests one policy exception; it never silently inherits or weakens the
review obligation.

## Semantic review package

Create one immutable semantic review package. It must provide paths and hashes
for:

- mission and binding requirement IDs;
- stable-ID requirement-to-evidence matrix;
- slice and selected lenses;
- complete change snapshot with immutable base and head SHAs;
- relevant unchanged interfaces and evidence receipts with claim/environment
  scope, Git tree, dirty-tree fingerprint, dependency freshness, and
  invalidation state;
- known unavailable proof;
- intended acceptance claims and requested completion state.

The reviewer must attempt to falsify every intended acceptance claim and report
each unverified obligation. A clean package is necessary but is not approval.

## Initial output

```markdown
## Review type
independent_review | self_review

## Semantic verdict
SEMANTIC_REVIEW_APPROVED | NEEDS_CORRECTION |
BLOCKED_BY_MISSING_EVIDENCE | SELF_REVIEW_ONLY

## Findings
- [Critical|Important|Minor] file:line: defect, consequence, proof.

## Scope inspected
Branch/range plus staged, unstaged, and untracked coverage.

## Lenses applied
What was checked and why.

## Unverified obligations
Requirements not established here.

## Checkout integrity
REVIEW_CHECKOUT_UNCHANGED | REVIEW_CHECKOUT_CHANGED |
REVIEW_CHECKOUT_UNVERIFIED
```

Critical/Important findings require action. Minor findings are fixed
opportunistically or durably recorded; they do not create a loop.

## Correction and one resumed recheck

The persistent owner fixes the whole Critical/Important batch in one
consolidated correction wave and runs focused covering proof. The same reviewer
performs one resumed recheck over original findings and the fix range only.
Correction/recheck accounting is separate from the reserved exact-final-head
integration review. Do not consume that reserved review before the candidate
stops changing. A defect found by the final review invalidates that head's
approval and requires a new exact-head review within finalization budget.

## Circuit breaker

If a load-bearing finding remains after the recheck, stop the loop. Choose one
evidence-backed route:

1. reviewer wrong: record technical ruling and proof;
2. contradictory requirement/design: `BLOCKED_BY_REQUIREMENT` or return to owner;
3. real but non-load-bearing: record explicit deferral;
4. real and load-bearing: revise design or stop blocked;
5. evidence unavailable: report the strongest partial state.

Silent dismissal is forbidden.
