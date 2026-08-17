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

`run.md` is regenerated from canonical machine state after migration. Manual
legacy prose remains historical context only and cannot outrank `run.json`,
receipts, ledgers, checkpoints, budgets, or actual Git state.
