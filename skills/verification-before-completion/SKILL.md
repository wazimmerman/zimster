---
name: verification-before-completion
description: Require fresh, scoped evidence before claiming code, integration, external, hardware, or human completion.
---

# Verification Before Completion

Adapted from Superpowers' evidence-before-claims discipline under the MIT
License.

## Iron law

```text
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before any claim that work is done, fixed, passing, ready, or safe:

1. identify the command or observation that proves it;
2. run it on the final relevant code and environment;
3. read the complete result, exit status, failure count, and warnings;
4. compare the evidence to the actual mission requirement;
5. state only the completion level the evidence supports.

An agent report, old run, passing linter, clean diff, or confident inspection is
not a substitute for the required proof.

## Verification ladder

Use the narrowest valid evidence during iteration, then fresh completion gates:

- focused RED/GREEN proof for changed behavior;
- affected tests and static checks for the slice;
- integration tests for component boundaries;
- full required project gates once on final code;
- external service, hardware, or human acceptance only in the actual required
  environment.

A final correction invalidates every proof whose dependency cone includes that
correction. Rerun those proofs; do not blindly rerun unrelated suites.

## Requirements audit

Tests passing does not prove every requirement. Re-read the mission and plan,
and map each obligation to:

- code or configuration location;
- automated evidence;
- integration evidence;
- external/hardware/manual evidence;
- explicit unavailable proof.

## Honest states

When required proof cannot run, say the work is blocked by environment rather than implying completion. Use language such as:

- `CODE_READY`—implementation and automated checks support the code claim;
- `INTEGRATION_VERIFIED`—required components were exercised together;
- `EXTERNAL_SERVICE_VERIFIED`—the named live service was tested;
- `HARDWARE_VERIFIED`—the exact hardware and parameters were tested;
- `HUMAN_ACCEPTANCE_VERIFIED`—the named manual acceptance was performed;
- `BLOCKED_BY_ENVIRONMENT`—required proof could not run here;
- `PARTIALLY_VERIFIED`—some obligations remain unproved.

Never let “all automated tests pass” imply hardware, service, or human proof.

## Report format

For every completion claim, include:

- command or observation;
- final result and counts;
- code range or final commit;
- relevant environment;
- requirements established;
- warnings, skipped tests, ignored tests, or unavailable evidence;
- strongest supported completion state.

If evidence fails, report the actual failure and continue debugging. Do not
soften it with “should,” “probably,” or “looks good.”
