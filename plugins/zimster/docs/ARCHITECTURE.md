# Architecture

## Objective

Zimster separates durable development discipline from orchestration volume. A
capable root model retains architecture and implements a coherent feature;
additional contexts are spent only where isolation or independent judgment
provides value.

## Layers

### 1. Harness-neutral skills

The twelve skills under `skills/` define workflow selection, design/planning,
persistent-owner execution, TDD, systematic debugging, bounded parallelism,
risk-adaptive review, Git isolation, review handling, and completion proof.
Core skills avoid hard-coded user paths and OS-specific shell assumptions.

### 2. Harness adapters

- **Codex:** the repository marketplace at `.agents/plugins/marketplace.json`
  points to `plugins/zimster/`. That directory is a self-contained generated
  plugin with accepted manifest fields, skills, operational scripts, config,
  schemas, templates, assets, and notices. Claude hooks are not inside it.
- **Claude Code:** `.claude-plugin/`, `skills/`, `agents/`, and `hooks/` expose
  native skills, bounded roles, and a compact `using-zimster` bootstrap.
- **Cursor:** `.cursor/commands/using-zimster.md` points to Agent Skills copied
  into `.agents/skills/`; no unsupported repository manifest or lifecycle hook
  is invented.
- **Kimi Code:** `.kimi-plugin/plugin.json` declares native skills and exactly
  one `sessionStart.skill` using documented fields.
- **OpenCode:** the dependency-free project plugin registers the packaged skill
  path and inserts one marked bootstrap; missing package content fails
  actionably.
- **Pi:** the `package.json` `pi` declaration loads the TypeScript extension and
  native skills; the extension has the same one-bootstrap and package-integrity
  invariants.

### 3. Operational control plane

Dependency-free Node 22 tools turn important policy into inspectable state:

- `init-run.mjs` creates durable execution state;
- `project-commands.mjs` inventories canonical project commands;
- `change-snapshot.mjs` represents committed, staged, unstaged, and untracked
  changes without touching the index;
- `evidence.mjs` records local proof receipts and validity fingerprints;
- `run-budget.mjs` enforces execution limits and proof-backed overrides;
- `accounting-reconcile.mjs` derives suite and exact-duplicate counts from
  durable governed execution identities, reports unobservable direct-shell
  history honestly, and audits any correction;
- `run-control.mjs` owns slice transitions, dirty recovery snapshots, resume
  reconciliation, and deterministic `run.md` refresh/check;
- `control-plane-mutation.mjs` serializes successful cross-store mutations,
  writes a phase marker before the canonical write, advances the run revision,
  refreshes the recovery checkpoint and derived summary, appends transaction-
  bound audit events, and validates invariants before returning;
- `phase-checkpoint.mjs` separates persistent logical ownership from bounded
  physical contexts and remains the legacy compact-checkpoint entry point;
- `verify.mjs` and `evidence.mjs run` persist a governed start before spawning,
  bind candidate/runtime/governing-policy provenance, and finalize against the
  exact terminal receipt bytes;
- `installed-package-smoke.mjs` exercises exact candidate archives in isolated
  homes before review packaging;
- `review-package.mjs` represents immutable canonical changes and mirror
  hashes without duplicating generated content, plus typed stable attempt IDs,
  reconstructable dirty state, binding requirement IDs, matrix state, intended
  claims, evidence scope, unavailable proof, and lenses;
- `review-lifecycle.mjs` persists one-reviewer typed attempt transitions and a
  hard cardinality of one primary review, one correction recheck, and two
  final integration reviews per semantic contract; exhaustion enters durable
  strategy escalation rather than opening another attempt;
- `review-authorization.mjs` admits final approval only from the approved
  verdict of the exact final-review attempt. Owner-managed dispatch/routing
  rows cannot authenticate a post-review reviewer result, so caller-authored
  rebuttal or deferral dispositions fail closed. Historical records remain
  preserved for audit but cannot authorize completion;
- review attempt IDs are globally unique across canonical seam lifecycles, and
  final completion binds the approved lifecycle attempt to the immutable
  review package's exact seam and package identity;
- `run-budget.mjs` admits a post-redesign correction recheck only when its
  explicit semantic-contract digest matches the current lifecycle candidate
  and that lifecycle is in the authorized recheck state, keeping budget scope
  aligned with the lifecycle's semantic epoch; candidate completion loads
  every canonical seam lifecycle and reconciles run-global aggregate history
  only to distinct authenticated lifecycle epochs across those seams;
- `coherence-preflight.mjs` compares the canonical run, checkpoint, derived
  summary, governed accounting, budget proofs, review lifecycle, assurance
  accounting, and exact checkout before final review, completion, or release;
- `assurance-accounting.mjs` reconciles supported host observations with
  dispatch, budget, review-attempt, and depth records and fails closed;
- `semantic-assurance.mjs` validates the requirement-to-evidence matrix,
  authenticates the Git-local execution budget, revalidates every override
  proof receipt against the current candidate and ledger, and deterministically
  gates candidate completion;
- `capability-cache.mjs` decides whether one host contract needs refreshed
  research;
- `run-postmortem.mjs` aggregates run-scoped observed/inferred/unavailable
  execution metrics;
- `dispatch-record.mjs` records requested/effective model routing;
- `delegation-record.mjs` records the delegation decision before routing;
- `model-routing.mjs` creates proposals and resolves mappings and fallbacks;
- `adapter-config.mjs` emits owned host overrides only for enforcing routing
  modes and only to an explicit output; advisory `recommend` remains inherited;
- `convergence.mjs` records bounded continue/escalate decisions;
- `sync-codex-plugin.mjs` generates the Codex plugin mirror;
- `validate-codex.mjs` checks the pinned official contract snapshot;
- `validate-claude-plugin.mjs` checks the current documented Claude manifest,
  hook, and plugin-agent contract when the host CLI is unavailable;
- `validate-adapters.mjs` rejects obsolete Cursor surfaces and validates the
  Kimi, OpenCode, and Pi package contracts;
- `check-version.mjs` and `bump-version.mjs` synchronize release metadata;
- `package.mjs` creates deterministic archives only from a current mirror and
  synchronized version set.

No run receipt or model record is uploaded. Normal runtime artifacts live
under the worktree-safe Git administrative path returned by
`git rev-parse --git-path zimster`, outside product history.

An interrupted transaction has only two honest recovery paths. A durable
`canonical_mutation_applied` marker lets `resume` finish the revision,
checkpoint, event, and summary deterministically. A marker that remains merely
`started` enters `RECOVERY_RECONCILIATION_REQUIRED`; Zimster preserves it and
does not guess whether the canonical command succeeded. When the owning store
proves that argument validation or another pre-write failure made no canonical
mutation, `run-control.mjs reconcile` archives the original marker with the
explicit reason, durable evidence, and candidate observed at reconciliation;
it never silently deletes the ambiguous record.

Execution-budget proof labels are immutable identities. A satisfied or
superseded label cannot be reused by a later override, and both semantic and
coherence gates reject ambiguous lookup. A historical duplicate remains in
place: `run-budget.mjs reconcile-identities` appends occurrence fingerprints
and source-to-occurrence bindings so validators traverse an explicit graph
without rewriting history or using last-wins lookup.

Self-host evidence has two layers. Candidate-bound evidence establishes that
the exact implementation can reconstruct and reconcile durable observations;
it does not depend on mutable current lifecycle or accounting files. The live
coherence gate separately requires assurance accounting to match the current
lifecycle and budget immediately before review, completion, and release. This
keeps capability proof stable while mutable authorization state still fails
closed when it advances.

When an exact governed verification has already executed bounded commands,
`evidence.mjs bridge-verification` can derive claim-scoped evidence without
re-execution. The bridge authenticates the upstream governed execution,
candidate, environment, profile, terminal receipt digest, selected passing
steps, and every selected log digest. The bridge operation also records its own
governed begin/finish lifecycle, so the derived receipt's exact terminal bytes
authenticate independently rather than borrowing the upstream execution's
identity. The derived receipt names the upstream verification and logs as
fingerprinted inputs. Each verification step must
declare its requirement IDs, positive claims, exclusions, and environment
scopes before execution. Executed helper programs are declared as
`input_files`, fingerprinted before execution, checked again afterward, and
carried into derived evidence. Each bridge receipt derives from one step only,
can select only a subset of its positive contract, and must preserve every
declared exclusion. It cannot bridge a failed, stale, handcrafted, changed, or
unselected step or broaden a step's claims after observing its result.

Claim-establishing receipts are authenticated governed terminal records with
explicit requirement/claim/input-fingerprint bindings. Nonempty parallel
arrays alone do not prove that relationship; receipts without a valid exact
binding remain diagnostic.

Exact release reconstruction uses tracked helpers. Clean-checkout
reproducibility builds and secret-scans the artifact set in two independent
detached clones. Self-host reconstruction runs the durable accounting,
recovery, transaction, and coherence integration fixtures in a fresh detached
clone; it does not read the live review lifecycle or assurance projection.

## Codex source and package flow

```text
canonical root files
→ npm run sync:codex
→ plugins/zimster/
→ pinned Codex contract validation
→ .agents/plugins/marketplace.json local reference
→ deterministic Codex marketplace ZIP
```

`sync:codex:check` compares every generated file digest and rejects missing,
changed, or extra files. Packaging refuses a stale mirror.

## Execution state

Create Git-local durable state when there is more than one slice, any subagent
or independent review, pending external/hardware proof, more than one commit
boundary, compaction risk, or a resumed session. `run.json` owns run identity
and workflow position: current slice/status, distinct next slice, completed
slices, exact next action/command, and guard assertions. Execution, evidence,
review, dispatch/delegation, and convergence ledgers own their observed facts;
`budget.json` owns policy and reconciled projections. A checkpoint is a compact
revision-bound recovery snapshot. `run.md` owns no mutable fact: the centralized
renderer deterministically derives it from these canonical stores and actual
Git state.

Detailed logs, diffs, and transcripts remain separate artifacts.
Projects may opt into a project-defined audit documentation path; normal
operation never turns approval or run bookkeeping into a standalone commit.

The logical implementation owner persists across physical contexts. Record a
slice start before implementation, then checkpoint material milestones,
verification failures/corrections, evidence/review/budget transitions, and
intentional context renewal. Dirty work is valid in-progress state: the
checkpoint carries base/current Git identity, dirty fingerprint, touched files,
obligations, compact failure, receipt validity, review/budget position, guards,
and exact continuation. It never embeds the full objective, passing logs,
historical diffs, or transcript. Resume reconciles actual Git state; ambiguity
reports `RECOVERY_RECONCILIATION_REQUIRED` rather than inventing history.

## Git state and review representation

A review cannot rely on `git diff` alone. The change snapshot includes:

```text
base..HEAD committed range (when supplied)
git diff --cached
git diff
git status --short
full text or hash/metadata for every untracked file
```

This supports both committed feature branches and explicit no-commit work. The
snapshot does not mutate the index.

## Evidence model

An evidence receipt includes:

- command, cwd, kind, and scope;
- Git head/tree and complete working-tree fingerprint;
- environment fingerprint;
- start/end time and exit code;
- test-discovery classification and exact counts;
- dependency cone, inputs, source, and notes;
- supported requirement IDs, established/excluded claims, and environment or
  harness scope;
- whether it was a final gate.

Semantic completion derives evidence purpose rather than trusting schema
presence: only requirement/claim-bound receipts with fingerprinted input or
dependency provenance establish claims. Unbound receipts are diagnostic.
Prospective TDD proof uses explicit behavior-matched, governed RED/GREEN receipt
pairs; absent historical RED evidence remains unavailable.

Focused evidence may be reused only on the same fingerprint. Documentation-only
changes rerun only affected provenance/packaging proof until the final gate is
due. Final gates are always fresh. Duplicate evidence is surfaced instead of
silently rerun.

## Semantic assurance model

Binding obligations receive stable IDs in a machine-readable requirement set.
The corresponding matrix names authoritative text/source, implementation
locations, evidence references, candidate tree and environment scope,
unavailable proof, status, and intended acceptance claims. Validation rejects
missing IDs, stale/invalidated/wrong-tree proof, dirty candidate evidence,
environment mismatch, and claims broader than their evidence.

Semantic review records distinguish `self_review` from `independent_review`.
Owner-inline work is always self-review. A review package binds the immutable
base/head, complete canonical snapshot, relevant unchanged interfaces, matrix,
evidence state, claims, unavailable proof, and selected lenses. Review attempts
to falsify those claims. Approval binds a stable semantic-contract digest over
binding text, intended claims, implementation locations, and stable evidence
environment scope. Candidate Git tree identity, receipt references, statuses,
observations, and verification results remain separately validated so final
proof can advance without invalidating an unchanged reviewed contract.

Review-package risk signals expand deterministically into their combined
semantic lenses. Public contracts, trust boundaries, external/live services,
shared adapters, plugin systems, durable state, migration, and release side
effects cannot silently collapse to only the framework-defaults lens; their
union includes the applicable scope, state, security, persistence, protocol,
fallback, falsifiability, resource, external-service, framework, and shared
control-flow lenses.

Host evidence is independent per harness. Receipt states distinguish live,
installed-package, structural, authentication-blocked, unavailable, and
unsupported evidence, and separately record whether model-backed execution
occurred. Public-beta completion requires one exact-package live host and
claim-bounded records for all public harnesses; stable may require stronger
coverage. Missing optional public-beta hosts narrow claims instead of becoming
fabricated passes or a universal completion failure.

Checkout integrity is orthogonal: `REVIEW_CHECKOUT_UNCHANGED`,
`REVIEW_CHECKOUT_CHANGED`, and `REVIEW_CHECKOUT_UNVERIFIED` describe only the
review checkout. Eligible Micro work may complete owner-only. Standard and
High-risk completion requires clean-context independent approval for the exact
head; High risk also requires load-bearing obligations and final integration
approval. Micro and load-bearing proof references must support the exact named
requirement ID and established claim. Missing review/proof yields an honest
partial or blocked state, never `CANDIDATE_COMPLETE`.

## Delegation and model-routing model

Delegation selection is independent and precedes model evaluation. A false
decision cannot create a proposal or dispatch. Selected decisions bind role,
reason, inline alternative, ownership, tools, dependency cone, stop condition,
and owner acceptance proof.

Plans may carry advisory proposals; dispatch regenerates authoritative,
single-use proposals from current inputs. Harness-neutral classes are
`economy`, `balanced`, `expert`, and `inherit`; legacy `fast` and `standard`
remain read aliases. Concrete model names exist only in optional configuration.
Resolution records provenance, capability evidence, fallbacks, and requested
versus effective values. Local outcome summaries never mutate policy.

## Autonomous convergence

Deterministic in-scope corrections continue without repeated authorization
within configurable budgets. Contradiction, material expansion, sensitive
authority gaps, missing review, required approval, and exhaustion are the only
escalation reasons. Self-hosting freezes accepted policy until candidate rules
are independently accepted.

## Agent topology and safety

```text
persistent implementation owner
├── optional pure read-only scout
├── at most two isolated implementers for disjoint work
├── pure read-only seam/integration reviewer
├── tree-guarded test reviewer for one named command
└── isolated diagnostician after repeated owner failure
```

Subagents do not spawn subagents. Pure reviewers have no Bash. Test-capable
roles record before/after fingerprints and report any mutation rather than
cleaning it.

## Review convergence

```text
complete initial finding batch
→ owner fixes Critical/Important findings together
→ owner may append further exact-candidate corrections before recheck starts
→ same reviewer performs one scoped resumed recheck
→ reserve final integration review until the exact candidate head is stable
→ require another exact-head review after any final-review correction
→ circuit breaker for load-bearing residuals
```

Those pre-recheck correction events update one candidate lineage; they do not
consume or create review attempts. Once the recheck starts, its exact candidate
is immutable.

An approved semantic candidate may advance its exact head and tree before a
final integration attempt is active without resetting bounded review
accounting, provided its semantic-contract digest and immutable base do not
change. The advance always clears stability, so a pre-admission correction
discovered after stabilization must renew exact evidence and stabilize again.
The reserved final integration review supplies the exact-head approval; once
that attempt is active, the assembly transition is closed.

Residuals route to technical adjudication, design/requirement blocker,
explicit deferral, diagnosis, or partial evidence instead of an unbounded
reviewer lottery.

## Completion model

Zimster separates code, integration, service, hardware, human acceptance,
environment blockers, requirement blockers, and partial verification. The
completion gate derives permitted claims only from valid matrix proof and emits
`CANDIDATE_COMPLETE` only after profile-appropriate semantic review. The final
report also states branch, commits, staged/unstaged/untracked files, and whether
implementation remains uncommitted.
