---
name: receiving-code-review
description: Evaluate review findings technically, fix valid defects in a batch, and preserve evidence when pushing back.
---

# Receiving Code Review

Review is independent evidence, not an authority ritual. Neither accept nor
reject a finding based on tone, model identity, or inconvenience.

## Process each finding

1. Restate the technical claim.
2. Locate the cited code and requirement.
3. Reproduce or reason through the consequence.
4. Classify it as valid, invalid, ambiguous, plan-conflicting, or missing
   evidence.
5. Record the decision and proof.

Ask for clarification only when the finding cannot be made testable from its
current wording.

## Valid findings

Combine related Critical and Important findings into one correction wave.
Ordinary accepted findings do not require separate user authorization for each
deterministic local correction; use the configured correction-commit budget.
Write or strengthen a failing proof where behavior is defective, then fix the
underlying invariant. Run focused covering tests and affected integration
checks.

A correction invalidates every affected evidence receipt and the prior
exact-head semantic approval. Update the requirement-to-evidence matrix and
review package for the corrected head before requesting the bounded recheck.

Do not make one agent or commit per finding when one owner understands the
shared cause. Rejecting delegated implementation returns the correction to
that owner; it does not automatically dispatch another implementer or alter
routing policy.

## Pushback

Push back when evidence shows the reviewer is wrong or the proposed fix would
violate the mission. Cite:

- exact requirement or interface;
- code location;
- focused test or experiment;
- alternative interpretation and consequence.

“It's intentional,” “the plan said so,” and “tests pass” are not sufficient by
themselves.

## Contradictions

A real conflict between the review and an approved requirement belongs to the
mission owner. Present both texts and the technical consequence. Do not quietly
change product behavior to satisfy a generic rubric.

## Recheck

Return the original finding batch and fix range to the same reviewer for one
resumed recheck. If a load-bearing dispute remains, use the review circuit
breaker rather than seeking fresh reviewers until one agrees.
