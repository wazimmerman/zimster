# Evaluation Strategy

Zimster's efficiency and quality claims must be established experimentally.
The repository intentionally does not claim that version 0.1.0 already beats
Superpowers.

## Comparison arms

Use paired runs on the same repository revision and task:

1. frontier model with no workflow instructions;
2. placebo process prompt of comparable shape but no mechanism;
3. current Superpowers release;
4. Zimster standard profile;
5. optional Zimster high-risk profile.

The no-framework and placebo floors separate genuine mechanisms from benefits
caused merely by authoritative process-shaped prose.

## Scenario portfolio

Include at least:

- small bug where the obvious fix is wrong;
- ordinary multi-file feature;
- asynchronous state-authority defect;
- concurrency/cancellation/resource-ownership feature;
- database migration with rollback;
- authorization or secret-handling change;
- frontend accessibility and stale-response behavior;
- native OS or hardware integration with explicit gated evidence;
- long-running autonomous task with compaction or context pressure.

Use hidden acceptance tests or blind artifact review where possible. Run at
least five paired repetitions per stable scenario and more when variance is
large.

## Quality metrics

- hidden acceptance pass rate;
- Critical/Important defects after declared completion;
- specification and scope compliance;
- regression-test falsifiability through revert or mutation;
- cross-component lifecycle defects;
- unsupported or fabricated evidence claims;
- maintainability and unnecessary implementation scope;
- reviewer false-negative and false-positive rates.

## Efficiency metrics

- total, input, output, and cached tokens;
- wall-clock duration;
- root and subagent turns;
- agent starts, resumes, and nested spawns;
- review and correction waves;
- tool calls and duplicate commands;
- focused, affected, subsystem, and full-suite test invocations;
- resident context size over time;
- time to first integrated passing vertical slice;
- stage at which each defect was discovered.

## Initial release gates

A candidate should satisfy all of the following against the current
Superpowers baseline:

- no increase in Critical defects;
- non-inferior hidden acceptance rate;
- no false claim of service, hardware, or human verification;
- median tokens at or below 50% of the baseline;
- median elapsed time at or below 60% of the baseline;
- 95th-percentile specialist identities no greater than eight;
- zero unapproved nested agents;
- one or fewer resumed rechecks per reviewed seam unless the circuit breaker
  explicitly changes strategy.

Targets are hypotheses until a campaign establishes confidence intervals.
Publish negative and null results alongside wins.

## Atmosvox-derived benchmark

A reduced native-audio fixture should preserve the difficult parts of the
motivating run: decoder-to-writer lifecycle, cancellation, state generations,
hotplug, exact parameter verification, and unavailable physical hardware. The
evaluation should compare when those seam defects are discovered—not merely
whether the final suite eventually passes.
