# Evaluation Strategy

Zimster's efficiency and quality claims must be established experimentally.
Version 0.4.0 does not claim to beat Superpowers.

The historical 0.3.0 hardening measurements and the mechanisms they motivated
are recorded in `docs/evaluations/v0.3.0-hardening-postmortem.md`.

## Comparison arms

Use paired runs on identical repository revisions/tasks:

1. frontier model with no workflow instructions;
2. placebo process prompt of comparable shape but no mechanism;
3. current Superpowers release;
4. Zimster Micro or Standard as appropriate;
5. Zimster High-risk for hard-trigger scenarios.

No-framework and placebo floors distinguish real mechanisms from authoritative
process-shaped prose.

## Scenario portfolio

Include small misleading bug fixes, ordinary multi-file features, async state
authority, concurrency/cancellation/resource ownership, migration/rollback,
authorization/secrets, frontend accessibility/stale responses, native
OS/hardware with gated proof, and long runs with compaction pressure.

Use hidden acceptance tests or blind artifact review where possible. Run at
least five paired repetitions per stable scenario and more for high variance.

## Quality metrics

- hidden acceptance pass rate;
- Critical/Important defects after completion;
- mission/scope compliance;
- behavior-specific RED and mutation falsifiability;
- cross-component lifecycle defects;
- unreviewed staged, unstaged, or untracked content;
- unsupported/fabricated evidence claims;
- canonical-command and test-discovery reporting accuracy;
- maintainability and unnecessary scope;
- reviewer false negatives/positives;
- requirement versus environment blocker accuracy.

## Efficiency metrics

- total/input/output/cached tokens;
- wall-clock duration;
- root/subagent turns;
- agent starts, resumes, nested spawns;
- requested versus effective model tier;
- review/correction waves;
- tool calls and duplicate commands;
- focused, affected, subsystem, and full-gate invocations;
- valid evidence reuses and stale-evidence rejections;
- resident context over time;
- time to first integrated passing slice;
- stage at which each defect appears.

## Operational-control evaluations

Add explicit hold-outs for:

- Codex ingestion rejects unsupported manifest fields;
- repo marketplace resolves only `plugins/zimster/`;
- implementation files remain untracked at review time;
- seven behavioral tests initially fail only at import;
- repository defines a canonical test script but an agent invents bad flags;
- a fast scout inherits the expensive parent model;
- a reviewer with shell access mutates the checkout;
- an evidence receipt is reused after a working-tree change;
- a release tag disagrees with package/plugin versions.

Run `node scripts/evaluate-execution-economy.mjs` for the deterministic local
fixture. It demonstrates duplicate-command reuse, budget warning behavior,
checkpoint resumption, and compact verification output without a costly live
goal. It is a mechanism test, not comparative performance evidence.

## Initial release gates

Against the current Superpowers baseline:

- no increase in Critical defects;
- non-inferior hidden acceptance;
- zero false service/hardware/human claims;
- zero unreviewed implementation files;
- median tokens ≤50% of baseline;
- median elapsed time ≤60% of baseline;
- P95 specialist identities ≤8;
- zero unapproved nested agents;
- ≤1 resumed recheck per seam unless strategy changes at the circuit breaker.

Targets remain hypotheses until confidence intervals support them. Publish
negative and null results.

## Atmosvox-derived benchmark

A reduced native-audio fixture should retain decoder/writer lifecycle,
cancellation, generation authority, hotplug, exact parameters, and unavailable
hardware. Compare when seam defects are discovered, not only whether a final
suite eventually passes.
