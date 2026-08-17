# Operational Controls

## Locating the tools

The tools live in the installed Zimster plugin, not in the user's project.
Resolve the Zimster root as the parent containing the harness manifest (for
Codex, `.codex-plugin/plugin.json`). Run tools with an absolute path while the
working directory is the target repository.

## Durable run state

```text
node <zimster>/scripts/init-run.mjs \
  --profile high-risk \
  --harness codex \
  --reason "public plugin compatibility" \
  --triggers "more than one vertical slice,independent review" \
  --commit-policy "commit at verified slice boundaries" \
  --next-slice-id slice-1 \
  --next-slice-title "First observable slice" \
  --next-action "Start Slice 1 before editing"
```

The command refuses to overwrite an existing run unless `--force` is explicit.
Normal state is written beneath `git rev-parse --git-path zimster`. Use
`--audit-path docs/<project-defined-path>.md` only for an explicit audit-mode
contract. Zimster does not edit tracked `.gitignore` for normal state.
The `--harness` value embeds the matching capability matrix in a
machine-readable JSON block; omit it only when the harness is genuinely
unverified.

Standard and High-risk initialization also creates a run identity, lifecycle
event stream, and machine-readable execution budget. Use
`scripts/run-budget.mjs record` for measured events and
`scripts/run-budget.mjs prove` to satisfy a proof-backed override. If a proof
relationship is later shown to be circular, `scripts/run-budget.mjs supersede`
preserves the original obligation and links one enforceable replacement; it
never erases the original override. Proof labels cannot be reused after they
become satisfied or superseded. If an older ledger already contains duplicate
labels, `scripts/run-budget.mjs reconcile-identities` requires explicit
override/supersession occurrence bindings and appends a fingerprinted
reconciliation record; it does not rename or remove either historical row.

If one governed verification already ran the bounded commands needed by
several matrix claims, derive narrow evidence without repeating them:

```text
node <zimster>/scripts/evidence.mjs bridge-verification \
  --verification-receipt <id> \
  --steps '["step-id"]' \
  --kind verification --scope <claim-scope> \
  --requirement-ids '["REQ-001"]' \
  --establishes '["Narrow claim"]' \
  --environment-scope <scope>
```

The bridge accepts only a passing exact-candidate governed verification and
digest-matching selected logs. Its receipt records the upstream verification
and does not create another execution or consume duplicate-command budget.
The selected verification steps must declare `requirement_ids`, `establishes`,
`does_not_establish`, and `environment_scopes` in the plan before execution.
An executed helper is also declared in `input_files`. The verifier fingerprints
those bytes before and after execution, and the bridge carries them into the
evidence dependency set. A bridge selects exactly one passing step, every
bridged field must be a subset of that step's declarations, and every declared
`does_not_establish` caveat must be retained. A passing result therefore cannot
be recombined or broadened afterward.

Start a slice durably before editing, checkpoint meaningful dirty progress, and
resume from actual repository state:

```text
node <zimster>/scripts/run-control.mjs start \
  --slice-id slice-1 --slice-title "First observable slice" \
  --next-slice-id slice-2 \
  --remaining-obligations '["focused behavior","affected gate"]' \
  --next-action "Implement the focused behavior" \
  --next-command "node --test test/focused.test.mjs"

node <zimster>/scripts/run-control.mjs checkpoint \
  --status awaiting_verification \
  --completed-obligations '["focused behavior"]' \
  --remaining-obligations '["affected gate"]' \
  --next-action "Run the affected gate" \
  --next-command "npm test"

node <zimster>/scripts/run-control.mjs resume
```

The checkpoint derives HEAD/tree, dirty fingerprint, and touched files; it can
also preserve compact corrections, findings, and generic side-effect guards.
`resume` reconciles uncheckpointed dirty progress only when a durably started
current slice supplies attribution. An unexpected HEAD or dirty legacy work
without a current slice reports `RECOVERY_RECONCILIATION_REQUIRED`.

`run.md` is derived. Use `run-control.mjs check` (or `npm run run:check`) to
report `STALE_RUN_SUMMARY`, and `run-control.mjs refresh` (or
`npm run run:refresh`) to regenerate deterministic bytes. Do not resolve drift
by treating a manual Markdown edit as authoritative. The legacy
`phase-checkpoint.mjs` compact interface remains readable during migration.

Pass `--convergence-config <path>` to snapshot validated limits. A self-hosting
candidate instead passes `--self-hosting-candidate <version>`,
`--accepted-policy-config <outside-repository-path>`, and the independently
known `--accepted-policy-sha256 <digest>`. Initialization rejects candidate-tree
policy and records the accepted artifact identity in the bootstrap receipt.
For a durable self-host run, bind the same accepted bytes to an immutable
pre-candidate Git object and materialize them under the Git-local runtime:

```text
node <zimster>/scripts/init-run.mjs bind-accepted-policy \
  --commit <accepted-commit-sha> --path config/convergence.json \
  --sha256 <independently-known-digest>
```

## Delegation, routing, and convergence

Record delegation first with `delegation-record.mjs decide`. Only a selected
decision may reach `model-routing.mjs propose`. Regenerate a dispatch-phase
proposal and resolve it with current task, Git, configuration, harness,
capability, catalog, and override evidence immediately before a v2 dispatch.
The dispatch command revalidates those inputs and consumes the proposal once.
It first creates an atomic proposal claim; concurrent dispatch/supersession loses
that claim without spawning. After an interrupted claim, the owner runs
`dispatch-record.mjs recover --proposal-id <id> --claim-id <id>` to finalize an
already recorded dispatch or release an uncommitted reservation. After delegated
implementation, the owner records acceptance only after proof.

Use `convergence.mjs decide --event <kind> --scope in-scope --sensitivity
ordinary --reversible true --authorized true --deterministic true --locality
local --metric <budget>` after an ordinary deterministic failure. A
`continue` record replaces repeated authorization; escalation or exhaustion
stops the autonomous path.

## Deterministic verification

```text
npm run goal:verify
npm run release:verify
```

The profile runner executes shell-free argv vectors, writes full logs and one
receipt beneath the Git-local `zimster/verification` directory, stops on the
first failure, and prints only a compact JSON summary. Consult existing
tree-keyed evidence before repeating a broad command.

## Capability cache and postmortem

```text
npm run capability:status -- --harness codex --host-version "<version>"
npm run postmortem
```

Capability status is scoped to one host. Expiry, version change, validator
contradiction, a task changing that integration, or an explicit fresh-research
request are the only refresh triggers. The postmortem is run-scoped and keeps
incompatible token meters separate.

## Canonical command inventory

```text
node <zimster>/scripts/project-commands.mjs <target-repository>
```

The JSON output lists repository instructions, package scripts, Make/Just/Task
entries, language tooling, and simple CI `run:` commands. It is an inventory,
not a claim that every listed command is required.

## Complete change snapshot

```text
node <zimster>/scripts/change-snapshot.mjs \
  --base <immutable-40-character-base-sha> \
  --head <immutable-40-character-head-sha> \
  --output /path/from/git-rev-parse/zimster/change-snapshot.md
```

The snapshot contains the committed branch range, staged and unstaged diffs,
status, and every untracked file. Text files are embedded; large/binary files
are represented by size and SHA-256. The index is unchanged.

## Reviewer checkout integrity

Before a shell-capable reviewer runs its one named command:

```text
node <zimster>/scripts/review-integrity.mjs capture \
  --base <immutable-40-character-sha> \
  --head <immutable-40-character-sha> \
  --review-files <mission-path>,<snapshot-path>,<evidence-path>
```

Afterward, pass the returned Git-local receipt path:

```text
node <zimster>/scripts/review-integrity.mjs verify \
  --receipt <receipt-path>
```

Any HEAD, index, tracked, untracked, or declared review-package mutation stops
the review with `REVIEW_CHECKOUT_CHANGED`; an unchanged checkout reports
`REVIEW_CHECKOUT_UNCHANGED`. These statuses never imply semantic approval. The
guard reports exact affected files and never stages, repairs, resets, or
discards them. Declared inputs may be absolute attachment or Git-local paths
outside the worktree.

## Immutable review attempts and circuit breaker

Create a separate Git-local package for each typed attempt:

```text
node <zimster>/scripts/review-package.mjs \
  --attempt-type initial_review --attempt-id <stable-id> --seam-id <stable-id> \
  --base <sha> --head <sha> \
  --binding-requirements <binding.json> --matrix <matrix.json>

node <zimster>/scripts/review-lifecycle.mjs init \
  --seam-id <stable-id> --reviewer-identity <stable-reviewer-id> \
  --base <sha> --head <sha> --tree <tree> \
  --dirty-tree-fingerprint <sha256> --semantic-contract-sha256 <sha256>

node <zimster>/scripts/review-lifecycle.mjs start \
  --seam-id <stable-id> --attempt-type initial_review \
  --attempt-id <stable-id> --reviewer-identity <stable-reviewer-id> \
  --review-package <git-local-review-package.json>
```

Record `verdict`, one owner `correction`, and the same reviewer's one
`correction_recheck`. A failed recheck persists the circuit breaker. The CLI
rejects another recheck, replacement-reviewer shopping, final review, and
completion until an evidence-backed `disposition` is recorded. A design
revision must change the semantic-contract digest and invalidates prior
attempts. `final_integration_review` is a distinct exact-head type after
`stabilize`; it never expands the correction-recheck allowance. Each semantic
contract permits at most one primary attempt, one correction recheck, and two
final integration attempts. A second failed final attempt enters durable
`strategy_escalation_required`; neither a new attempt ID nor a generic budget
override can reset that hard limit.

Before the required primary attempt starts, `review-lifecycle.mjs candidate`
may update the exact head/tree/dirty identity while preserving the same
semantic-contract digest. It consumes no attempt and cannot be used to smuggle
in a contract change; changed semantics still require `design_revision`.

A load-bearing final integration finding may also require `design_revision`
when its correction changes the stable semantic contract. That disposition is
recorded directly from `final_correction_required`, invalidates prior attempts,
and requires new-design approval before another final integration review.

Before admitting a final integration attempt, inspect the whole canonical
control plane without repairing it:

```text
node <zimster>/scripts/coherence-preflight.mjs check \
  --operation review --seam-id <stable-id>
```

`COHERENCE_BLOCKED` reports every detected drift or stale dependency. Repair
the owning state through its normal command, regenerate `run.md`, and rerun the
check. Do not edit the derived summary or copy state into alternate paths.

## Synchronized state mutations

Supported evidence add/invalidate/run, governed verification start/result,
review lifecycle, budget/proof, accounting, dispatch/delegation, convergence,
host evidence, completion, and release-evidence commands pass successful
canonical writes through one Git-local mutation boundary. That boundary uses a
runtime lock, atomic writes where the store permits them, transaction-bound
audit rows, a revision-matched checkpoint, deterministic `run.md` refresh, and
post-write invariants.

If a fresh process finds an in-flight marker, run:

```text
node <zimster>/scripts/run-control.mjs resume
```

A canonical-write marker is completed mechanically. A pre-write/ambiguous
marker remains visible in the checkpoint and `run.md` as
`RECOVERY_RECONCILIATION_REQUIRED`; do not delete it or claim the operation
succeeded without reconciling the owning store.

If the owning store proves that a `started` transaction made no canonical
mutation, archive it through the evidence-required no-op disposition:

```text
node <zimster>/scripts/run-control.mjs reconcile \
  --transaction-id <id> \
  --disposition no_canonical_mutation \
  --reason <why-the-owning-store-did-not-change> \
  --evidence <durable-observation>
```

The command refuses a changed run-state revision, preserves the original
marker under `transactions/reconciled/`, records whether the candidate changed
after interruption, advances the canonical revision, and refreshes the
checkpoint and `run.md`.

Reconcile supported host observations before completion:

```text
node <zimster>/scripts/assurance-accounting.mjs reconcile \
  --observed <candidate-bound-host-observation.json>
```

The receipt fails closed unless observed agent IDs exactly match dispatch and
budget identities, observed attempt IDs exactly match durable lifecycle
attempts, every lifecycle reviewer is an observed accounted agent, and observed
depth is at most one. When the host cannot expose
authoritative activity, report reconciliation unavailable rather than using an
empty observation as proof.

If durable dispatch or lifecycle ledgers prove that budget projections are
stale, repair only those projections with an explicit audit reason:

```text
node <zimster>/scripts/assurance-accounting.mjs reconcile \
  --observed <candidate-bound-host-observation.json> \
  --repair-projections --reason <why-the-ledger-outranks-the-projection>
```

The repair preserves lifecycle and dispatch history, records every prior and
corrected value, and still fails closed when the host observation itself does
not match the authoritative ledgers.

## Evidence receipts

Initialize or record supplied evidence:

```text
node <zimster>/scripts/evidence.mjs init
node <zimster>/scripts/evidence.mjs record \
  --kind test --scope focused --command "npm test" --exit-code 0 \
  --test-discovery tests_executed --tests-passed 42 --tests-failed 0 \
  --dependencies "src/cache.js,test/cache.test.js"
```

Run and record a command:

```text
node <zimster>/scripts/evidence.mjs run \
  --kind test --scope affected --test-discovery tests_executed -- \
  npm test
```

Check or find reusable proof:

```text
node <zimster>/scripts/evidence.mjs check --id <receipt-id>
node <zimster>/scripts/evidence.mjs find \
  --kind test --scope focused --command "npm test"
```

Receipts become stale when the complete working-tree fingerprint, normalized
Node/npm/OS and declared host version, dependency declaration, or content
fingerprints for declared input paths change. Supply the same `--host-version`
when checking host-bound evidence. `--reuse` is allowed only for non-final
work; final gates are rerun.

New receipts may also carry `--requirement-ids`, `--establishes`,
`--does-not-establish`, and `--environment-scope`. Use JSON arrays when a claim
contains commas. This prevents a narrow native harness or fixture from being
reported as broad compatibility proof.

Test-discovery values are `not_reached`, `zero_discovered`, `tests_executed`,
and `unknown`. `unknown` and `not_reached` carry no counts; `zero_discovered`
requires zero counts; `tests_executed` requires positive, internally consistent
counts. An agent should supply exact counts rather than infer them from a zero
exit code.

## Legacy dispatch records

Dispatch v1 records created by Zimster 0.5 remain readable and updateable, but
the v1 writer is closed. New dispatches require a selected delegation decision,
an authoritative proposal, and a resolution linked through `--delegation-id`,
`--proposal-id`, and `--resolution-id`.

After the harness reports effective routing:

```text
node <zimster>/scripts/dispatch-record.mjs update \
  --id <dispatch-id> --effective-model <name-or-unverified> \
  --effective-effort <value-or-unverified> --agent-id <id>
```

A fast role that actually used the parent model is marked with a warning.
The v1 reader/update path remains for 0.5 compatibility. New work uses
delegation, proposal, resolution, and v2 dispatch IDs described in
`CONFIGURATION.md`.

## Requirement matrix and candidate completion

Start from `templates/binding-requirements.json` and
`templates/requirement-matrix.json`. Replace example SHAs with the exact
candidate commit/tree and keep the matrix outside product history unless the
project explicitly requires a committed audit artifact.

```text
npm run assurance -- matrix \
  --requirements <binding-requirements.json> \
  --matrix <requirement-matrix.json> \
  --evidence <receipts.jsonl>

npm run assurance -- complete \
  --profile high-risk --owner-verified \
  --load-bearing-review-obligations <candidate-bound-obligations.json> \
  --requirements <binding-requirements.json> \
  --matrix <requirement-matrix.json> \
  --evidence <receipts.jsonl> \
  --reviews <review-records.json> \
  --review-package <review-package.json> \
  --review-lifecycle <review-lifecycle.json> \
  --assurance-accounting <assurance-accounting.json> \
  --execution-budget .git/zimster/budget.json
```

The first command reports coverage and proof/claim blockers. The second also
performs the same canonical coherence preflight and requires a clean current
checkout and profile-appropriate review. Owner-inline
inspection is `self_review`; Standard and High-risk need clean-context
`independent_review` for the exact base/head, package ID, stable
semantic-contract digest, required lens set, and a reconciled execution budget
with every override proof durably satisfied. Standard and High-risk completion
accept only the authoritative Git-local budget; a copied or caller-authored
snapshot is rejected. Each satisfied proof is rechecked against the current
evidence or verification ledger, invalidations, environment, and exact
candidate tree. Evidence-type budget proof receipts must match the current Git
commit and tree even when their dependency cone remains reusable for ordinary
evidence purposes. Proof receipts must be issued by a governed execution whose
terminal bytes authenticate against the execution ledger, and the execution
must finish before the override creates the obligation. Post-override receipts
are circular; manual `evidence record` receipts are not budget proofs. When a
correction makes a satisfied proof stale,
`run-budget.mjs supersede` preserves the old receipt and links a new required
proof before completion can resume. The contract digest covers
binding meaning, intended claims, implementation locations, and stable evidence
environment scope. Candidate Git tree identity, mutable receipt references,
statuses, observations, and verification results are validated separately.
High-risk obligation records bind the candidate
head/tree to evidence references that match the exact requirement ID and exact
established claim; Micro uses `--micro-eligibility`
with all risk dimensions Low, no hard trigger or public contract, and
candidate-bound deterministic proof references with the same exact
requirement-and-claim linkage. Boolean eligibility or
load-bearing switches are not accepted. Review unavailable produces
`OWNER_VERIFIED_REVIEW_UNAVAILABLE` or another non-candidate state.

Release-evidence creation repeats the preflight for `release` and binds its
requested commit and tree to the coherent checkout. A successful earlier
completion receipt cannot authorize release after any run, checkpoint,
accounting, lifecycle, proof, summary, or checkout drift.

## Release controls

```text
npm run version:bump -- <next-version> --note "Release summary"
npm run version:check
npm run sync:codex:check
npm run release:verify
npm run postmortem
```

`version:bump` updates package/lock versions, three current primary manifests, Claude
marketplace entry, changelog heading, and the generated Codex mirror.
`version:check -- --tag v<next-version>` additionally validates a release tag.

## Privacy

All Git-local evidence, dispatch, snapshot, and run files remain on the local
machine. Zimster contains no upload or telemetry mechanism. Pass `--no-receipt`
or set `ZIMSTER_RECEIPTS=off` to run without recording receipt state.

## Diagnostics and failure semantics

Normal progress quietly applies expected capability fallbacks. Use
`npm run doctor -- --json` for the complete machine-readable matrix. Invalid
packages, reviewer mutation, failed required commands, corrupted state, and
unfulfilled required verification remain actionable errors. See
`DIAGNOSTICS.md` for the full distinction and `SKILLS_ONLY.md` for the
script-free path.
