# Zimster 0.7.1 Acceptance-Evidence Integrity Plan

## Outcome

Make requirement proof, generated postmortems, and prospective TDD claims truthful and mechanically bound before the 0.7.1 release candidate is approved.

## Slice A: Claim-establishing evidence

- RED: a valid-schema receipt with empty requirement/dependency metadata is classified diagnostic and cannot verify a matrix row.
- RED: a receipt naming a requirement and claim but lacking fingerprinted input/dependency provenance cannot verify it.
- GREEN: derive and expose deterministic `claim_establishing` versus `diagnostic` classification; admit only authenticated exact-candidate evidence with an explicit requirement/claim/input-fingerprint binding.

## Slice B: Durable postmortem binding

- RED: a generated report has an authenticated canonical-state manifest; changing a relevant budget, dispatch, review, correction, suite, or evidence input makes validation stale.
- RED: release authorization rejects a stale or disproven postmortem.
- GREEN: centralize a deterministic durable-state snapshot/digest, atomically maintain canonical `postmortems/latest.json`, add `run-postmortem check`, and require its freshness at final-review, completion, release, and release-evidence gates.

## Slice C: Truthful prospective TDD proof

- RED: a TDD claim with no RED receipt, a passing RED, a failed GREEN, mismatched behavior, reversed timestamps, or unauthenticated governed execution is unavailable.
- GREEN: require every matrix row to declare `tdd_evidence` as `required` or `not_claimed`, record explicit TDD phase/behavior/predecessor metadata, and validate an authenticated behavior-specific RED→GREEN pair without inferring historical compliance.

## Verification and commit boundary

- Run only focused RED/GREEN tests during implementation, then the repository-required gates and one exact-package 0.7.1 release verification after the final source change.
- Synchronize the generated Codex mirror before verification.
- Inspect status, staged and unstaged diffs, and untracked files; commit this semantic-contract slice at its verified boundary.
