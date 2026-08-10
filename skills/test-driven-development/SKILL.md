---
name: test-driven-development
description: Develop behavior through verified, behavior-specific RED-GREEN-REFACTOR cycles and falsifiable tests.
---

# Test-Driven Development

Adapted from Superpowers' TDD discipline under the MIT License.

## Iron law

```text
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

RED must fail for the expected reason: the behavioral defect, not a typo, broken
fixture, missing dependency, or unrelated setup error.

## RED for one behavior

Write the smallest test or executable reproduction for one observable behavior.
State:

- the production defect/change that this test detects;
- expected failure signal;
- why current behavior should fail.

Run it. A passing test proves no new behavior. A command that fails before test
discovery proves only setup failure.

## Multi-behavior features

For multiple behaviors, a “module not found” RED does not prove the individual
behavior tests. It proves only that the module is absent; each load-bearing
behavior still needs falsifiable evidence.

Use one or a combination of:

1. incremental RED-GREEN cycles for each load-bearing behavior;
2. a deliberately incomplete stub that permits each behavioral test to fail
   meaningfully before implementation;
3. focused mutation checks that remove or invert each important invariant and
   demonstrate the corresponding test becomes RED.

Several behaviors may share one commit and one efficient test invocation, but
the evidence must identify meaningful RED for each load-bearing behavior.

Prefer real behavior over mock-call choreography. Mock only unavoidable
boundaries and assert externally meaningful outcomes.

## GREEN

Write the least production code that makes the focused RED pass. Do not add
speculative options or unrelated refactors. Run the focused proof, then the
smallest affected repository-declared test group.

## REFACTOR

Only after GREEN:

- remove duplication;
- improve names/boundaries;
- simplify control flow;
- extract a reusable unit when a second real use exists.

Keep focused and affected proofs green; refactoring adds no behavior.

## Regression and falsifiability checks

For a bug fix, or for a high-value invariant in a multi-behavior feature:

1. run final code and observe GREEN;
2. temporarily revert or mutate the essential behavior;
3. observe the targeted expected RED;
4. restore the implementation and observe GREEN.

A test that remains green when its protected behavior is removed is decorative.
Record mutation evidence without committing the temporary defect.

## Existing/hard-to-test code

- Characterize behavior before risky refactors.
- Difficult tests often reveal difficult interfaces; simplify first.
- Control scheduling for concurrency; do not rely on arbitrary sleeps.
- Separate deterministic contracts from explicit hardware/service gates.

## Exceptions

Generated artifacts, declarative configuration, disposable exploration, and
documentation-only edits may use the nearest useful validation. Record the
reason. Exploration code is not quietly promoted to production.

## Stop conditions

Stop when production precedes proof, RED is unrelated, a test checks source
text/constants, mocks verify themselves, tests are weakened for the
implementation, or warnings/flakiness make evidence ambiguous.

## Completion checklist

- Every changed behavior has a falsifiable proof.
- Each load-bearing behavior has meaningful RED evidence.
- GREEN was observed on final implementation.
- Bug and high-value invariant tests survive a revert/mutation check.
- Required edge/failure cases are covered.
- Affected tests pass with unambiguous output.
