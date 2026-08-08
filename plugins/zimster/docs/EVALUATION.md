# Evaluation protocol

Zimster performance claims require reproducible comparative evidence. Local
mechanism tests prove that a workflow feature behaves as designed; they do not
prove that Zimster improves coding-agent outcomes. Null and negative results are
publishable results.

## Final v0.7 candidate mechanism evidence

The final v0.7 candidate adds oversized-request decomposition and an optional
visual-treatment decision to `designing-work`. Focused behavioral tests, the
existing deterministic mechanism suite, exact-head semantic review, and
reproducible release artifacts establish the candidate's workflow and packaging
contracts. They do not establish a comparative effect on coding outcomes.

No comparative benchmark has been run against the final v0.7 candidate. The
completed pilot below is retained as historical evidence for the earlier
treatment and for the evaluation system itself; it is not final-candidate
evidence.

## Historical pre-change v0.7 pilot

The completed pilot applies to commit
`95dfedf7d396a7b9faa72ced844a28f70bd6bcef`. Its treatment used the canonical
skills at that commit, before the two `designing-work` behaviors were added.
The results therefore do not apply to or describe the final v0.7 candidate.

The first campaign uses [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe)
through [Pier](https://github.com/datacurve-ai/pier). DeepSWE supplies the task
images and deterministic verifiers. Pier is benchmark infrastructure, not a
model provider. The source revisions, 113-task population, Codex version, model,
and reasoning level are frozen in `benchmarks/lock/deepswe-v1.1.json`.

Both conditions used locally installed Codex CLI `0.146.1`, `gpt-5.6-sol`, high
reasoning, one concurrent trial, no retry, identical task images, identical
timeouts, and ChatGPT Pro authentication. The pilot used no API-key billing, no
purchased or promotional credits, no alternate provider, and no paid judge:

- `control`: task-repository instructions with no Zimster plugin or skills;
- `treatment`: the canonical `skills/` tree embedded read-only in the task
  image and discovered through Codex's Agent Skills directory.

The treatment measures the effect of Zimster's portable Agent Skills workflow
in Codex. It does not exercise or evaluate every host-specific capability of
the full installed Codex marketplace package. Package, runtime, and mechanism
correctness are established separately by package and mechanism tests.

For this v0.7 pilot, the harness rejects API-key authentication,
provider/base-URL overrides, a
different Codex version, or a run without an explicit operator assertion that
automatic credit top-up is disabled. It never installs or selects an alternate
model provider. Authentication material remains outside the task repository and
is uploaded by Pier only to the trial's temporary Codex home.

Task selection was frozen before scoring by ranking all task IDs with SHA-256
using the public seed in `benchmarks/manifests/codex-pro-pilot.json`. The first
ranked task is calibration-only. Conditions alternate first position across
paired blocks.

Campaign sizes are:

- calibration: one excluded task per condition;
- prespecified minimum pilot: 6 tasks × 2 conditions × 2 repeats = 24 runs;
- preferred pilot: 8 tasks × 2 conditions × 3 repeats = 48 runs.

## Historical minimum-pilot result

The minimum campaign completed on 2026-08-07 with 12 complete pairs, 24
scored runs, no incomplete pairs, and no retries. The treatment passed 10 of 12
runs (83.33%) and control passed 9 of 12 (75%), for a paired risk difference of
+8.33 percentage points and a seeded task-cluster bootstrap 95% confidence
interval of 0 to 25 percentage points.

Treatment averaged 914.701 seconds versus 1,031.920 seconds for control, 64.75
turns versus 73.75, and 29,128.7 output tokens versus 32,430.8. These are
descriptive pilot estimates: all Holm-adjusted secondary p-values are 1, and
the complementary task-clustered GEE treatment odds ratio is 1.667 (p=0.388).
There were no statistically significant Holm-adjusted secondary effects. The
result does not establish a definitive quality or efficiency gain, and the
+8.33-point estimate is not general proof that the plugin package is superior.

The calibration pair passed in both conditions and was excluded as planned.
The tracked public result at
`benchmarks/results/codex-pro-pilot-minimum.json` contains the exact run
contract, calibration evidence, analysis/manifest/lock hashes, all 24 raw
content-addressed bundle hashes, exclusions, and the bounded conclusion. Raw
traces remain outside Git.

Only complete, scorable control/treatment pairs enter comparative analysis. If
included usage ends, the harness attempts to finish the active pair, checkpoints
the campaign, and stops before starting another. A pair in which either result
lacks deterministic verifier output is excluded, never imputed as comparative
evidence.

## Outcomes and scoring

The primary outcome is the DeepSWE deterministic verifier pass indicator. The
primary effect is the treatment-minus-control paired risk difference. Confidence
intervals use a seeded nonparametric cluster bootstrap that resamples task IDs
and retains all repeats within a sampled task.

Secondary outcomes are successful completion, wall-clock duration, agent turns,
input/cached/output tokens when Codex exposes them, tool calls, retries, and
failure class. Efficiency is reported twice:

1. unconditionally across all runs, including failures;
2. conditional on successful completion.

Secondary hypothesis families use Holm correction. A mixed-effects or GEE model
is complementary analysis, not a replacement for the paired estimate; it is run
only when the campaign contains enough independent task clusters for a stable
fit. No model judge assigns the primary score. Human adjudication is limited to
documented verifier or harness ambiguity and must not rewrite deterministic test
results.

## Evidence and privacy

Raw Pier jobs, Codex trajectories, runner logs, and patches are kept outside the
tracked tree under `.git/zimster/benchmarks/`. Each job becomes a
content-addressed `sha256/<digest>` bundle with a file inventory. Public evidence
contains the frozen manifest and lock hashes, run-level bundle hashes,
exclusions, failure classes, and analysis output. It does not contain
credentials, account identifiers, authentication paths, or tokens.

The visible plan-window state is recorded categorically and without account
identifiers before a campaign. Never purchase credits or enable top-up on behalf
of the campaign. Resume only after the included-usage window resets.

## Reproduction

Independent replications must record authentication and billing mode and hold
them constant between conditions. They must never silently change model,
provider, or authentication. Record the exact model, reasoning level, CLI
version, runner version, task locks, and plugin condition for every campaign.

Check the fixed schedule without using model allowance:

```sh
npm run benchmark:plan -- --campaign minimum
```

For the subscription-backed v0.7 campaign, the runner retains its
auto-top-up-disabled safeguard. This campaign-specific protection does not make
one person's account settings a universal scientific requirement. Use a
categorical plan-window description:

```sh
npm run benchmark:preflight -- \
  --confirm-auto-top-up-disabled \
  --plan-window-state included-usage-available-identifiers-omitted
```

Check out the exact DeepSWE and Pier commits from the lock, then run calibration:

```sh
npm run benchmark:run -- \
  --campaign calibration \
  --deepswe /absolute/path/to/deep-swe \
  --pier /absolute/path/to/pier \
  --confirm-auto-top-up-disabled \
  --plan-window-state included-usage-available-identifiers-omitted
```

Use `--resume` to continue the same campaign. Use `--max-pairs 1` for a bounded
smoke. Analyze any exported JSON Lines record file with:

```sh
npm run benchmark:analyze -- --records /absolute/path/to/records.jsonl
```

The deterministic implementation and fixtures are in `benchmarks/lib/pilot.mjs`
and `test/benchmark-pilot.test.mjs`.

## Future comparative evaluation

A new campaign for the final v0.7 candidate or a later release is post-v0.7
work. Its design must first pass the registered evidence-sufficiency and cost
planning analysis. The historical pilot's variance, runtime, and cost data will
inform the run allocation, including whether more unique tasks with fewer
repeats provide better information per Codex hour than the old preferred design.

Superpowers and GSD may be neutral comparators under the same frozen Codex run
contract. SWE-Interact, SWE Atlas, Terminal-Bench 2.1, or another suite should be
added only when it answers a defined evaluation question. Any API-billed,
external-provider, contamination-sensitive, or paid-judge campaign requires a
separate approval and a distinct label. Null and negative results remain
publishable.
