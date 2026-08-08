---
name: systematic-debugging
description: Reproduce failures, isolate root cause with evidence, and fix them through a regression test.
---

# Systematic Debugging

Do not begin with a plausible patch. Begin with a verified symptom and an
explanation that accounts for the evidence.

## 1. Reproduce

Capture the smallest reliable reproduction:

- exact command, input, environment, and observed output;
- whether the failure is deterministic;
- the last known good version or condition when available;
- the component boundary where expected behavior first diverges.

If the reported problem cannot be reproduced, gather logs or instrumentation.
Do not manufacture certainty.

## 2. Establish the causal chain

Trace data and control flow backward from the bad observation:

1. What value or state is wrong?
2. Which producer created it?
3. What assumptions did that producer make?
4. Which upstream event violated those assumptions?
5. Why did existing validation or tests not catch it?

For distributed, asynchronous, or native boundaries, record timestamps,
identifiers, generations, ownership, and cleanup, not only error strings.

## 3. Form competing hypotheses

List the few explanations consistent with the evidence. Rank them by how much
they explain, not by convenience. Design the smallest discriminating
experiment for the leading hypotheses.

Change one variable at a time. Instrument before rewriting. A failed hypothesis
is useful evidence; remove its instrumentation when finished.

## 4. Confirm root cause

A root-cause explanation must predict:

- the original failure;
- at least one nearby edge case;
- why the obvious or prior fix was insufficient;
- the location where a durable invariant can prevent recurrence.

If the same attempted fix fails twice, stop cycling. Re-examine the model,
consult one bounded diagnostician, or revise the design.

## 5. Fix through TDD

Load `test-driven-development`:

- encode the smallest regression proof;
- observe RED on the defective behavior;
- implement the invariant-level fix;
- observe GREEN;
- perform a revert or mutation check;
- run affected tests and any concurrency/resource cleanup checks.

Avoid symptom suppression, arbitrary retries, broader timeouts without a
bounded policy, or exception swallowing.

## 6. Verify and report

Report separately:

- reproduced symptom;
- root cause and evidence;
- fix and invariant restored;
- regression proof;
- commands run and results;
- related risks not tested;
- external or environmental limitations.

Do not call a problem fixed because logs look quieter or the code compiled.
