# Evaluation protocol

Zimster performance claims require reproducible comparative evidence. Local
mechanism tests prove that a workflow feature behaves as designed; they do not
prove that Zimster improves coding-agent outcomes. Null and negative results are
publishable results.

## Primary v0.7.0 pilot

The first campaign uses [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe)
through [Pier](https://github.com/datacurve-ai/pier). DeepSWE supplies the task
images and deterministic verifiers. Pier is benchmark infrastructure, not a
model provider. The source revisions, 113-task population, Codex version, model,
and reasoning level are frozen in `benchmarks/lock/deepswe-v1.1.json`.

Both conditions use locally installed Codex CLI `0.146.1`, `gpt-5.6-sol`, high
reasoning, one concurrent trial, no retry, identical task images, identical
timeouts, and the owner's ChatGPT subscription authentication:

- `control`: task-repository instructions with no Zimster plugin or skills;
- `treatment`: the canonical `skills/` tree embedded read-only in the task
  image and discovered through Codex's Agent Skills directory.

The harness rejects API-key authentication, provider/base-URL overrides, a
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
- minimum interpretable pilot: 6 tasks × 2 conditions × 2 repeats = 24 runs;
- preferred pilot: 8 tasks × 2 conditions × 3 repeats = 48 runs.

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
exclusions, failure classes, and analysis output—not credentials, account
identifiers, authentication paths, or tokens.

The visible plan-window state is recorded categorically and without account
identifiers before a campaign. Never purchase credits or enable top-up on behalf
of the campaign. Resume only after the included-usage window resets.

## Reproduction

Check the fixed schedule without using model allowance:

```sh
npm run benchmark:plan -- --campaign minimum
```

Run the safety preflight after manually confirming auto top-up is disabled in
the account UI. Use a categorical plan-window description:

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

## Later diagnostics

SWE-Interact, SWE Atlas, and Terminal-Bench 2.1 are later diagnostic suites.
SWE-bench Verified is not a headline benchmark for this release. Superpowers and
GSD comparisons require the same Codex authentication and run contract. Any
API-billed, external-provider, contamination-sensitive, or paid-judge campaign
requires a separate approval and a distinct label.
