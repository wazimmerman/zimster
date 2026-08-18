# 0.7.2 recovery scope

Zimster 0.7.2 is a bounded recovery release from the last trusted 0.7.0 tree.
The failed 0.7.1 commits and signed tag remain available as incident history,
but they are not the architectural base for this release.

## Subsystem decisions

| Failed 0.7.1 area | Decision | 0.7.2 boundary |
|---|---|---|
| Model routing | KEEP | Preserve economy, balanced, expert, and inherit; requested/effective reporting; strict-cost; and fallback behavior. |
| Bounded implementation dispatch | KEEP | Permit two genuinely independent implementers, keep root integration ownership, and reject nested recruitment. |
| Review lifecycle | REIMPLEMENT SMALLER | Use one deterministic state machine: initial review, one owner correction wave, same-reviewer recheck, then circuit breaker or owner strategy escalation. Final exact-head review is separate. |
| Hard limits | REIMPLEMENT SMALLER | Check hard lifecycle and economic stops before recoverable budget logic. Proof, invalidation, a semantic digest, or a new attempt cannot override exhaustion. |
| Design revisions | REIMPLEMENT SMALLER | Retain aggregate run/seam consumption with compact counters instead of replenishing capacity through review epochs. |
| Run and checkpoint recovery | SIMPLIFY | Keep canonical `run.json`, current-slice state, dirty-tree fingerprinting, touched files, latest failure/test, and the exact next action or command when known. |
| `run.md` | SIMPLIFY | Make it a deterministic projection of canonical state, never a second source of truth. |
| Verification accounting | SIMPLIFY | Count only executions observed through governed wrappers. Do not run suites to decorate accounting. |
| Evidence | SIMPLIFY | Distinguish diagnostic receipts from claim-establishing evidence and validate the active candidate frontier. Keep superseded evidence for audit. |
| Prospective TDD evidence | SIMPLIFY | Accept only actually observed governed RED/GREEN pairs; do not reconstruct historical phases. |
| Postmortem | SIMPLIFY | Derive a fixed-point observation from canonical state without creating a new obligation or semantic revision. |
| 0.7.0 durable state | REIMPLEMENT SMALLER | Migrate deterministically, preserve known history, retain unknown facts as unknown, and fail closed for facts required by current completion. |
| Release tag verification | REIMPLEMENT SMALLER | Preserve and verify the annotated tag object, then prove its peeled commit matches the intended release commit. |
| Recursive proof and freshness machinery | DISCARD | Remove recursive proof obligations, global freshness revisions, historical proof graphs, and reconciliation that manufactures new blockers. |
| Supervisory control plane | DISCARD | Do not add reconciliation agents, reviewer-per-lens, fixer-per-finding, proof-backed hard-limit overrides, or mandatory ceremony for small edits. |

## Governing boundary

The accepted/restored policy governs this recovery. Candidate helpers are
exercised only in isolated fixtures, package homes, or clean checkouts and do
not decide whether their own development run may continue.

Release qualification is bounded to one structural/install smoke per host and
at most one already-authenticated model-backed smoke. Host limitations narrow
claims; they do not authorize new 0.8/0.9/1.0 architecture.
