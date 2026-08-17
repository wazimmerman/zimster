# Zimster 0.7.1 Durable Execution Control Plane Plan

## Mission and constraints

- `CTRL-STATE-001`: Assign one authoritative machine-readable owner to every durable fact; make `run.md` a deterministic projection rather than an independent record.
- `CTRL-SLICE-001`: Persist distinct current and next slices, a finite slice status, the exact next action, and the exact next command; record slice start before implementation and never complete a dirty or failing slice.
- `CTRL-RECOVERY-001`: Checkpoint compact dirty in-progress state, repository identity, touched files, obligations, latest verification/failure, findings, evidence state, budgets, reviews, guard assertions, and recovery actions; reconcile actual repository state on fresh-process resume.
- `CTRL-SUMMARY-001`: Centrally render, refresh, and check `run.md`; supported mutations refresh it and drift reports `STALE_RUN_SUMMARY`.
- `CTRL-EXEC-001`: Count broad suites and exact duplicate commands only through governed executions with durable pre-execution identity, compact outcomes, receipts, events, and candidate/runtime provenance.
- `CTRL-ACCT-001`: Reconcile receipt-backed counters, reviews, corrections, agents, dispatch/delegation, and related events without rewriting history; audit corrections and report `ACCOUNTING_UNVERIFIED` where facts cannot be reconstructed.
- `CTRL-PROOF-001`: Reject circular or arbitrary caller-supplied proof. A trusted receipt must establish the registered obligation independently and bind to the applicable candidate, environment, source, runtime, and governing-policy identity.
- `CTRL-EVIDENCE-001`: Represent stale evidence explicitly during correction and reject it at dependent final-review, completion, or release claim time.
- `CTRL-LIFE-001`: Treat hard review cardinality separately from soft retry budgets. One semantic candidate gets a bounded correction lifecycle and bounded final closing review; exhaustion durably enters strategy escalation and only a material semantic reset creates a new lifecycle.
- `CTRL-BUDGET-EPOCH-001`: Evaluate correction-recheck hard cardinality per authenticated semantic-contract epoch at completion; reconcile aggregate historical usage only to distinct durable lifecycle attempts and reject duplicate rechecks within any epoch.
- `CTRL-REVIEW-ID-001`: Treat review attempt IDs as run-global identities across all canonical seam lifecycles and bind final completion to one exact seam, attempt, and immutable review-package ID.
- `CTRL-MIGRATE-001`: Read-upgrade representative 0.7.0 state without deleting unknown fields, events, receipts, or history; reconcile ambiguous dirty legacy runs explicitly.
- `CTRL-MUTATE-001`: Use narrow locked/atomic mutation primitives so canonical state, audit events, recovery snapshots, derived summary, and invariants cannot casually diverge after successful commands.
- `CTRL-PREFLIGHT-001`: Fail closed before final review, completion, and self-hosting release finalization when durable state, recovery, accounting, lifecycle, evidence, proof, or required host/delegation claims are incoherent.
- `CTRL-PACKAGE-001`: Ship and exercise applicable initialization, slice, checkpoint, governed verification, summary, resume, reconciliation, lifecycle, and preflight behavior in every full-runtime 0.7.1 artifact; skills-only modes disclose and fail closed on unavailable enforcement.
- `CTRL-SELFHOST-001`: Reconstruct and reconcile the current 0.7.1 run from existing Git-local ledgers and Git history without fabricating or erasing facts, under the frozen accepted 0.7.0 policy.
- Existing `LIFE-*`, `PKG-*`, `ACCT-*`, `NEST-*`, `ROLE-*`, `HOST-*`, `REL-*`, and `SCOPE-*` release requirements remain binding. This is the same 0.7.1 release, excludes planned 0.8 semantic-assurance expansion, and excludes official OpenAI, Claude, and Grok directory submission.

## Requirement-to-evidence matrix

| Requirement | Authoritative implementation | Required evidence and scope | Unavailable proof / claim boundary |
| --- | --- | --- | --- |
| `CTRL-STATE-001`, `CTRL-SUMMARY-001` | `scripts/lib/run-state.mjs`, a centralized run-summary library/CLI, schemas and templates | Unit tests for ownership/invariants; process integration proving populated deterministic output, drift detection, and refresh | Direct edits outside supported commands are detected on check, not intercepted |
| `CTRL-SLICE-001`, `CTRL-RECOVERY-001` | versioned run/checkpoint schemas and slice/checkpoint CLI | Real temporary Git repository: init, start, dirty files, governed failure, abrupt fresh-process resume, correction, second resume, verified completion | SIGKILL cannot trigger a final write; recovery proves pre-write plus resume reconciliation |
| `CTRL-EXEC-001`, `CTRL-ACCT-001` | existing verification/evidence runner, execution ledger, budget reconciliation, assurance accounting | Three governed full suites equal count three; exact duplicate identity test; forced mismatch audit; dependent admission rejects stale/unverified accounting | Arbitrary host shell commands remain mechanically unobserved and cannot satisfy claims |
| `CTRL-PROOF-001` | execution-budget proof obligations plus existing evidence/build provenance | Circular proof mutation test; arbitrary receipt rejection; exact candidate/environment/runtime/governing-policy bindings | External provenance not emitted by a host is unavailable rather than inferred |
| `CTRL-EVIDENCE-001` | evidence validity, checkpoint/summary renderer, preflight | Stale receipt visible mid-correction; final claim fails; renewed exact-candidate receipt passes | Expensive evidence is not rerun after every edit |
| `CTRL-LIFE-001` | review lifecycle, convergence/accounting, strategy-escalation state | Repeated distinct findings cannot create unbounded attempts; lifecycle exhaustion escalates; trivial changes cannot reset; material contract digest reset can | A generic soft-budget override never authorizes a hard lifecycle transition |
| `CTRL-BUDGET-EPOCH-001` | semantic assurance plus lifecycle-authenticated execution-budget scopes | Completion fixture with three historical rechecks across multiple seams and semantic epochs passes; two rechecks in one seam/epoch or an unreconciled run-global aggregate fails | Legacy aggregate counts remain visible per seam and are accepted only when all canonical lifecycle attempts reconcile them |
| `CTRL-REVIEW-ID-001` | review lifecycle, assurance accounting, semantic completion, coherence preflight | Duplicate attempt IDs across two seams fail reconciliation; mismatched package seam or package ID cannot borrow another lifecycle's final approval | Historical attempts remain visible but cannot collapse into a shared observed identity |
| `CTRL-MIGRATE-001` | run/checkpoint/budget readers and reconciliation | Representative 0.7.0 fixtures retain unknown/history fields; dirty ambiguous legacy case reports reconciliation required | Missing historical execution facts remain unavailable/unverified |
| `CTRL-MUTATE-001`, `CTRL-PREFLIGHT-001` | shared state lock/atomic writer/mutation coordinator and preflight CLI | Partial/stale fixture failures for summary, dirty checkpoint, evidence, accounting, lifecycle, proof, and escalation; valid fixture passes | Intermediate correction state may remain non-final-clean |
| `CTRL-PACKAGE-001` | package allowlists, installed-package smoke, compatibility docs | Exact built 0.7.1 artifacts exercise the applicable control path; full suite, package validation, two-clean-clone reproducibility | Skills-only parity is expressly not claimed |
| `CTRL-SELFHOST-001` | Candidate-bound reconciliation capability receipt plus live Git-local assurance/coherence state | Stable evidence proves the exact candidate can reconstruct durable observations without depending on lifecycle files that the review itself must mutate; final preflight separately requires the current lifecycle, budget, checkpoint, and accounting projections to reconcile | Unobservable historical direct shell executions are not retroactively counted |

The release semantic-assurance matrix will carry these IDs with exact receipt IDs after the last relevant candidate change.

## Profile and rationale

High risk. State recovery and migration affect user work; budget/proof/lifecycle rules are authorization boundaries; self-hosting provenance and signed distribution are trust boundaries; and realistic interruption behavior requires multi-process integration. Concurrency is Medium because mutations may race. Blast radius, observability, compatibility, security/trust, and migration are High. Novelty is Medium because existing stores and runners are being made coherent rather than replaced.

## Git and durable-state policy

- Continue on `codex/release-0.7.1` from release base `8411b2d66daac9881af58a997e01d492dd40c5e0`; do not discard prior commits or Git-local ledgers.
- Commit each verified vertical slice. Keep dirty/failing work uncommitted but durably mark the slice in progress or blocked.
- Accepted frozen 0.7.0 policy, not candidate 0.7.1 helpers, governs authorization of this release. Candidate helpers run only as implementation/test subjects until accepted.
- Checkpoint at slice start, material milestone, verification failure/correction, review/evidence/budget transition, intentional renewal/yield, and completion.
- No new delegation is selected: the root owner can implement the coherent shared-state seams, and additional agents would add coordination cost. The existing user-provided final reviewer remains reserved for the eventual immutable candidate.

## Architecture and ownership

- `run.json` owns run/plan identity, profile/rationale, workflow position, distinct current/next slices, obligations, exact next action/command, completed slices, guard assertions, and state revision.
- `events/events.jsonl` is the append-only audit history for supported transitions and reconciliation; it is not a mutable current-state cache.
- `checkpoints/current.json` is a compact recovery snapshot derived from a named run revision plus actual Git/receipt/review/budget observations. Copied workflow fields are references/projections and must match their owner.
- Verification/evidence execution receipts own observable governed command facts. Candidate, command, cwd, profile/context, source/runtime, environment, start, and compact result determine reuse/accounting.
- `budget.json` owns policy limits, non-receipt usage, proof obligations, and a reconciled projection of receipt-backed usage. Governed receipts/review/dispatch ledgers outrank stale counters during reconciliation.
- Review lifecycle files own attempt/cardinality/current escalation facts; dispatch/delegation ledgers own agent activity; evidence and verification ledgers own evidence validity; convergence records own convergence decisions.
- `run.md` owns no mutable fact. A deterministic renderer reads the above stores, reports missing/unverified state, and emits stable bytes without volatile timestamps.
- A narrow runtime lock and atomic file replacement serialize supported cross-store mutations. Append-only audit rows include a transaction/reconciliation identity so interrupted multi-file updates can be detected and repaired.

## Verification commands

- Focused: `node --test test/durable-run-control.test.mjs`, `node --test test/governed-execution.test.mjs`, lifecycle/accounting/evidence test files, and deliberate load-bearing mutations.
- Affected: operational tools, execution economy, verification runner, review lifecycle CLI/library, assurance accounting, semantic assurance, packaging, skills sync, public product, and release integrity/evidence suites.
- Canonical: `npm run check`, `npm run version:check`, `npm run sync:codex:check`, `npm run release:verify` at the correct final phase, and `git diff --check`.
- Distribution: exact installed-package control-plane smoke for all applicable artifacts, host smokes with explicit limitations, secret scans, and two clean-checkout byte-identical builds.

## Slice 1: Interrupted work resumes from canonical durable state

- Add `test/durable-run-control.test.mjs` with incremental RED cases A-I and S/T: initialized current/next separation, durable start, dirty fingerprint/files, governed failure recovery, second interruption, guarded completion, deterministic summary drift repair, populated output, stale evidence visibility, and legacy migration ambiguity.
- Version `run.json` and checkpoint schemas; preserve unknown legacy state. Add slice start/update/complete and checkpoint/resume/reconcile commands around existing Git-state/evidence helpers.
- Add a centralized deterministic summary renderer/checker. Init and every supported execution-state mutation refresh it.
- Mutation proof: delete slice-start persistence, dirty reconciliation, summary check, or completion guard and show focused tests fail.
- Commit after focused/affected tests, mirror sync, and diff checks.

## Slice 2: Governed executions are the source of receipt-backed accounting

- Add `test/governed-execution.test.mjs` RED cases J-O: three full suites, exact duplicate identity, ungoverned-shell nonclaim, mismatch reconciliation/audit/admission block, circular proof, and untrusted receipt rejection.
- Extend the verification/evidence path with durable pre-execution execution identity and compact terminal receipt. Derive suite/duplicate observations from governed execution IDs; reconcile projections under the runtime lock.
- Bind proof receipts to registered independent predicates, exact candidate/environment, build/source/runtime provenance, and governing-policy/candidate-under-test role.
- Mutation proof: remove command/candidate/provenance/obligation binding or reconciliation admission and show focused tests fail.
- Commit after focused/affected tests, mirror sync, and diff checks.

## Slice 3: Review convergence is finitely stateful

- Add RED cases P-R and final-preflight fixtures: distinct useful findings and generic override data cannot exceed a semantic candidate's hard lifecycle; exhaustion enters durable strategy escalation; administrative/trivial changes do not reset; a documented material contract change does.
- Separate hard lifecycle counters from soft budget overrides. Model a bounded initial/recheck path and a bounded final/closing path with explicit exhausted state.
- Integrate lifecycle/accounting reconciliation and a fail-closed coherence preflight for review, completion, and self-hosting finalization.
- Migrate existing out-of-bound history without deletion: retain attempts, mark accepted-policy deviations, and require strategy/design disposition rather than another generic review authorization.
- Commit after focused/affected tests, mirror sync, and diff checks.

## Slice 4: Public runtime and exact artifact behavior

- Wire remaining evidence, review, dispatch/delegation, budget, proof, convergence, finalization, and initialization mutations through summary refresh/checkpoint/invariant helpers.
- Update schemas, CLI help, templates, architecture/operations/configuration/migration/compatibility/release docs, canonical skills, generated Codex mirror, package allowlists, and changelog.
- Extend installed-package smoke to exercise init, slice start, dirty checkpoint, governed verification, summary check/refresh, fresh-process resume, reconciliation, hard lifecycle, and completion preflight where the artifact supplies mechanical runtime. Document skills-only limits and fail closed for parity claims.
- Commit after focused/affected/canonical verification and exact artifact smoke.

## Integration and completion

- Reconcile this live run from existing run/checkpoint/budget/event/evidence/verification/review/convergence/dispatch/delegation/Git state. Preserve every historical row, record unknowns, audit corrected projections, enter the lifecycle state mandated by frozen 0.7.0 policy, and regenerate `run.md`.
- Add all new IDs to binding requirements and semantic assurance; renew exact-head semantic, suite, host, package, and release evidence only after the last relevant change.
- Inspect `git status --short`, unstaged/staged diffs, and all untracked files. Run canonical gates, version checks, mirror check, diff check, secret scan, exact packages, and two-clean-checkout reproducibility.
- Build one immutable exact candidate package and use the existing combined-lens reviewer only through the newly finite permitted lifecycle. A load-bearing failure after the closing review escalates; it does not authorize review #3.
- After exact candidate approval and coherence preflight, restore any required credentials, merge normally, create/verify the signed `v0.7.1` authorization tag, publish GitHub prerelease/non-Latest and npm, verify workflow/provenance/checksums/install smokes, and only then close issue #6.
