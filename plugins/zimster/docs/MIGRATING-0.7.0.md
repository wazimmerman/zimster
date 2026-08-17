# Migrating durable state from 0.7.0

Zimster 0.7.1 reads existing Git-local 0.7.0 run and checkpoint state in place.
It does not delete historical events, receipts, reviews, budgets, unknown
fields, or legacy checkpoint fields.

`run-control.mjs resume` upgrades `run.json` schema 2 to schema 3 and a legacy
checkpoint to schema 2. A clean legacy checkpoint whose `exact_next_slice`
names future work becomes a distinct `next_slice`; it does not automatically
become current.

If the legacy checkpoint says a slice is next while the actual worktree is
dirty and no durable slice-start record establishes attribution, migration
preserves the candidate next slice and records:

```text
RECOVERY_RECONCILIATION_REQUIRED
```

The touched files and current dirty fingerprint are retained for owner
reconciliation. Zimster does not guess that the dirty work belongs to the named
next slice. Resolve the ambiguity explicitly, then start or restore the current
slice and checkpoint it. Missing historical suite/duplicate observations remain
`unavailable` or `unverified`; they are not reconstructed from memory.

After migration, `accounting-reconcile.mjs check` compares the 0.7.0 projected
suite/duplicate counters with any governed 0.7.1 execution receipts. An audited
`reconcile` may correct those two projections. Historical direct shell commands
remain `not_observable`; migration never invents execution IDs for them.

Reconcile a legacy review lifecycle before attempting another review:

```text
node <zimster>/scripts/review-lifecycle.mjs reconcile \
  --seam-id <stable-id>
```

The reconciliation replays and preserves every legacy event and attempt,
attaches the 0.7.1 hard review policy, and records a `policy_reconciled` event.
If legacy history exceeds one primary review, one correction recheck, or two
final integration reviews for the same semantic contract, the excess attempt
IDs remain enumerated and the lifecycle enters durable strategy escalation.
Migration never deletes or silently relabels them. Continue only through an
evidence-backed disposition or a material design revision with a new semantic
contract digest; renaming an attempt or making a trivial edit does not reset
cardinality.

Legacy approval dispositions that contain only caller-supplied evidence
references do not acquire release authority during migration. `reconcile`
preserves the old event, appends `legacy_untrusted_approval_reconciled`, and
restores the failed correction recheck's circuit breaker or the failed final
review's required strategy escalation. Choose a material design revision,
`blocked_by_requirement`, or `partial_or_blocked`; only an approved exact
final-review verdict can authorize completion.

`run.md` is regenerated from canonical machine state after migration. Manual
legacy prose remains historical context only and cannot outrank `run.json`,
receipts, ledgers, checkpoints, budgets, or actual Git state.

After resolving migration ambiguity, run `coherence-preflight.mjs check` for
the intended `review`, `completion`, or `release` operation. The preflight is
read-only and reports all remaining drift; it does not repair or conceal
unknown historical facts.
