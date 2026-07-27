---
name: test-driven-development
description: Develop behavior through a verified RED-GREEN-REFACTOR cycle and falsifiable tests.
---

# Test-Driven Development

Adapted from Superpowers' TDD discipline under the MIT License.

## Iron law

```text
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

The test must fail for the expected reason: the requested behavior is absent or
incorrect, not because the test has a typo, broken fixture, or unrelated error.

## RED

Write the smallest test or executable reproduction that describes one
observable behavior.

Before implementation, state:

- what production change would make this test fail;
- the expected failure signal;
- why existing behavior does not already satisfy it.

Run it. If it passes immediately, the test does not prove the new behavior.
Correct the test or identify that no production change is needed.

Prefer real behavior over assertions about mock call choreography. Mock only an
unavoidable boundary, and assert the externally meaningful result.

## GREEN

Write the least production code that makes RED pass. Do not add speculative
options, refactor unrelated areas, or broaden the feature beyond the proof.

Run the focused test. Then run the smallest affected group that can expose a
regression caused by the change.

## REFACTOR

Only after GREEN:

- remove duplication;
- improve names and boundaries;
- simplify control flow;
- extract reusable code when a second real use exists.

Keep the focused and affected proofs green. Refactoring must not add behavior.

## Regression tests

For a bug fix, prove the regression test is capable of detecting the defect:

1. run the test with the fix and observe GREEN;
2. temporarily revert or mutate the essential fix;
3. run the test and observe the expected RED;
4. restore the fix and observe GREEN again.

A test that stays green when the defect is restored is not a regression test.

## Existing and hard-to-test code

- Characterize existing behavior before a risky refactor.
- A difficult test often exposes a difficult interface; simplify the design
  before constructing a giant fixture.
- For nondeterministic concurrency, control scheduling or assert invariants
  across repeated focused runs rather than sleeping arbitrarily.
- For hardware or external services, separate deterministic contract tests from
  explicit gated integration evidence.

## Exceptions

An exception may be appropriate for generated artifacts, declarative
configuration, disposable exploration, or documentation-only edits. Record the
reason and use the nearest useful validation. Exploration code is not quietly
promoted to production.

## Stop conditions

Stop and correct course when:

- production behavior was written before its proof;
- RED failed for an unrelated reason;
- a test only checks source text or a constant;
- mocks verify themselves rather than production behavior;
- the test was weakened to accommodate the implementation;
- warnings or flaky output make the evidence ambiguous.

## Completion checklist

- Every changed behavior has a falsifiable proof.
- RED was observed for the expected reason.
- GREEN was observed on the final implementation.
- Bug regressions survive a revert or mutation check.
- Edge and failure cases required by the mission are covered.
- Affected tests pass with unambiguous output.
