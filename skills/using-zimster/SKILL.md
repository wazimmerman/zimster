---
name: using-zimster
description: Select the smallest Zimster workflow and risk profile that materially improves a software-development task.
---

# Using Zimster

One capable agent normally owns planning, implementation, debugging, review,
isolation, and evidence-based completion.

<SUBAGENT-STOP>
A subagent follows its bounded assignment and named skill. It does not restart
the full workflow or recruit more agents.
</SUBAGENT-STOP>

## Select the smallest workflow

Do not load every skill; plan or dispatch only when it materially helps.

| Situation | Load |
|---|---|
| Low-risk change | `test-driven-development`, then verification |
| Unexplained failure | `systematic-debugging`, then TDD |
| Consequential multi-file change | `designing-work`, then `writing-plans` |
| Approved plan | `owner-driven-development` |
| Two genuinely independent workstreams | `dispatching-parallel-agents` |
| Reviewed seam or integration range | `risk-adaptive-review` |
| Branch completion or handoff | `finishing-a-development-branch` |

User and repository instructions override Zimster defaults.

## Deterministic execution profile

Classify the six dimensions in `risk-adaptive-review`, then select one profile.
Always report the selected profile and its risk rationale before implementation.

### Micro

Use Micro only when every dimension is Low: one local slice, no public contract
or meaningful concurrency, security, data, service, OS, or hardware boundary;
deterministic automated proof; and no independent review.

The owner implements, runs focused/affected proofs, and performs fresh final
verification.

### Standard

Use Standard for subsystem or cross-component work with Medium dimensions but
no High dimension or hard trigger. Review the concentrated integration seam.

### High risk

Use High risk for any High dimension or hard trigger: trust/secrets; destructive
data or rollback; concurrency/resource ownership; public compatibility; OS,
hardware, unstable service, live-only evidence; or broad new architecture.

The owner consults at most one targeted specialist when useful, reviews the
load-bearing seam early, and obtains one final integration review.

## Semantic assurance contract

Keep separate: checkout integrity (`REVIEW_CHECKOUT_UNCHANGED` or
`REVIEW_CHECKOUT_CHANGED`) only reports checkout change; evidence validity binds
a receipt to tree, cone, environment, and claim; `self_review` is owner-inline;
`independent_review` is bounded-context falsification.

Owner-inline review is always `self_review` and cannot satisfy Standard or
High-risk independent review. Micro needs eligibility and a passing matrix.
Standard/High-risk need approved exact-head `independent_review`; High-risk also
needs all load-bearing obligations and final integration review. If unavailable,
report `OWNER_VERIFIED_REVIEW_UNAVAILABLE`, never readiness. Only the deterministic completion gate may
emit `CANDIDATE_COMPLETE`.

## Durable state trigger

Resolve `<zimster-runtime>` from installed `using-zimster` when it contains
scripts/init-run.mjs, else the plugin root; never the target repo.

Use `<zimster-runtime>/scripts/init-run.mjs` for multiple slices or commits,
delegation, independent review, external/hardware evidence, compaction, or
resume. It writes canonical state and a derived view under the path from
`git rev-parse --git-path zimster`, outside product history.

A Micro task may omit state only when none apply. Start before implementation;
keep current/next slices distinct. Checkpoint dirty progress, corrections,
evidence/review/budget transitions, and renewal. Resume reconciles Git and
preserves files, obligations, failure, guards, receipts, and exact next action.

`run.md` is a deterministic derived view, never an independent source. Use
`run-control.mjs check` to detect drift and `refresh` to repair it. On resume,
a completed canonical-mutation marker is synchronized; an ambiguous marker
remains `RECOVERY_RECONCILIATION_REQUIRED`, never permission to invent success.

Canonical state must pass `coherence-preflight.mjs check` for final review,
completion, or release; it never repairs drift.

Use `--audit-path <project-relative-documentation-path>` only for an explicit committed-audit opt-in. Do not modify tracked `.gitignore` for operational state.

## Delegation and model routing

Use `<zimster-runtime>/scripts/delegation-record.mjs` first: price/mappings never
delegate and `selected: false` forbids routing. Selected roles record inline
option, ownership/tools, cone, stop, and owner proof. Then model-routing.mjs may
propose routing from `config/model-routing.json`. Resolve override → run →
project → user → harness → inherit; record requested/effective values and owner
acceptance with `<zimster-runtime>/scripts/dispatch-record.mjs`. Classes are
economy, balanced, expert, and inherit; unknown values stay `unverified`.

Default limits:

- maximum two parallel implementation agents;
- model routing does not increase the default frequency of delegation;
- subagents must not spawn subagents;
- one initial review and one resumed recheck per reviewed seam;
- correction commits/rechecks use their bounded accounting;
- an exact-final-head integration review remains separately reserved until the
  candidate stops changing.

## Cost controls

Use focused tests while iterating, affected suites at slice boundaries, and one
full gate. At 60% of budget report consumers; at 80% prioritize required proof.
Never lower a required quality gate silently.

Initialize the execution budget for Standard/High-risk runs. Use `verify.mjs`
and `evidence.mjs run` so governed start precedes spawn. Derive suite/duplicate
counts from execution identities; run `accounting-reconcile.mjs check` before
dependent claims and audited `reconcile` for mismatch. Direct shell runs are
unobservable. Record agents/depth, rechecks, corrections, renewals, research,
and token thresholds. Limit crossings need a strategy change and named proof.

A budget proof must be a pre-existing passing governed verification/evidence
receipt. Its terminal bytes must authenticate against the execution receipt,
and its candidate, environment, runtime provenance, issuer, governing-policy
role, and required relationship must match. A receipt created after the
override is circular and cannot satisfy that override; manual `evidence record`
receipts are never budget proofs.

Use `<zimster-runtime>/scripts/convergence.mjs decide` for ordinary deterministic failure. Continue
without repeated authorization only in-scope, reversible, non-sensitive,
authorized work within budget. Escalate only for contradiction, material
expansion, sensitive authority gaps, missing review, required approval, or
exhaustion. Host permission prompts remain authoritative.

## Logical ownership and phase checkpoints

The logical owner is continuous across renewed contexts. Persist slice start.
At milestones, checkpoint Git state, files, obligations, verification/failure,
corrections, receipts, findings, review/budget, guards, and exact continuation.
Keep logs/diffs outside; resume the interrupted slice before later work.

## Deterministic verification and evidence reuse

Use `npm run goal:verify` and `npm run release:verify` once available instead of
their constituent commands. Keep full logs in Git-local artifacts and return the
compact receipt summary to the active context. Before repeating a broad
command, check for a valid receipt keyed to the current tree, dirty state,
environment, exact argv, dependency cone, and inputs. Required fresh final
gates are never reused.

Release sequence: build packages → installed-package smoke → host smoke →
review package → reserved exact-head final integration review → bounded
correction/review if needed → fresh exact-tree verification → completion gate.
Source-only review never replaces available installed-package proof.

## Capability research and postmortem

Use only the in-scope dated capability cache; refresh for expiry, host change,
validator contradiction, or request. Keep observed, inferred, and unavailable metrics
distinct and never sum incompatible token meters.

## Harness adaptation

Read only the matching reference:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`
- Grok/Cursor/Kimi/OpenCode/Pi: `references/other-harnesses.md`

When subagents are unavailable, execute inline and state that independent
review assurance was unavailable; do not relabel owner-inline work as
`independent_review`.

For self-hosting, freeze accepted policy; candidate rules stay non-authoritative
and isolated until review and acceptance pass.

## Installed version and script-free mode

Read adjacent `references/build-metadata.json` for version, build, source
commit/tree and cleanliness, and package target; never infer these from the
target project's metadata or Git history.

Without scripts, continue quietly: preserve safety, TDD, review, and
verification; mark helper receipts unavailable and maintain compact state
manually. Do not warn.
