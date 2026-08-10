# Evaluation

Zimster was evaluated during v0.7 development with a controlled, paired
DeepSWE pilot. The primary question was whether adding Zimster's portable Agent
Skills workflow in Codex changed deterministic task pass rates. Runtime, agent
turns, token use, and other efficiency measures were secondary outcomes.

Because this was a small pilot of one workflow build, its result should not be
generalized to every task, model, host, or later mechanism.

## DeepSWE pilot during v0.7 development

The benchmark tested the canonical Zimster skills at commit
`95dfedf7d396a7b9faa72ced844a28f70bd6bcef`. Oversized-request decomposition
and optional visual treatment were added to `designing-work` later in v0.7
development and tested separately.

## Results

The prespecified minimum pilot completed on 2026-08-07 with 12 complete pairs
and 24 scored runs. There were no incomplete pairs and no retries. The Zimster
condition passed 10 of 12 runs (83.33%); control passed 9 of 12 (75%). The
paired risk difference was +8.33 percentage points, with a seeded task-cluster
bootstrap 95% confidence interval of 0 to 25 percentage points.

| Mean per scored run | Zimster | Control | Difference from control |
|---|---:|---:|---:|
| Wall-clock time | 914.701 seconds | 1,031.920 seconds | 11.4% less |
| Agent turns | 64.75 | 73.75 | 12.2% fewer |
| Output tokens | 29,128.7 | 32,430.8 | 10.2% fewer |

The efficiency differences are descriptive estimates. All Holm-adjusted
secondary p-values were 1, and there were no statistically significant
Holm-adjusted secondary comparisons. The complementary task-clustered GEE
treatment odds ratio was 1.667 (p=0.388). This small pilot is an encouraging
signal from development, not proof of universal superiority.

The calibration pair passed in both conditions and was excluded as planned.
The public result file,
`benchmarks/results/codex-pro-pilot-minimum.json`, contains the run contract,
calibration result, analysis, manifest and lock hashes, all 24 raw
content-addressed bundle hashes, exclusions, and statistical conclusion. Raw
traces remain outside Git.

## Test setup

The pilot used [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe) through
[Pier](https://github.com/datacurve-ai/pier). DeepSWE supplied the task images
and deterministic verifiers; Pier ran the benchmark. The source revisions,
113-task population, task selection, Codex version, model, and reasoning level
are frozen in `benchmarks/lock/deepswe-v1.1.json` and
`benchmarks/manifests/codex-pro-pilot.json`.

Both conditions used:

- Codex CLI `0.146.1`;
- `gpt-5.6-sol` with high reasoning;
- one concurrent trial and no retry;
- identical task images and timeouts; and
- ChatGPT Pro authentication.

The conditions differed only in the Zimster treatment:

- `control`: task-repository instructions with no Zimster plugin or skills;
- `treatment`: the canonical `skills/` tree mounted read-only in the task image
  and discovered through Codex's Agent Skills directory.

This setup measures Zimster's portable Agent Skills workflow in Codex.
It does not exercise or evaluate every host-specific capability in the full
Codex marketplace package. Package correctness is established separately by
package and mechanism tests.

Task selection was frozen before scoring by ranking all 113 task IDs with
SHA-256 and the public seed in `benchmarks/manifests/codex-pro-pilot.json`. The
first ranked task was reserved for calibration. Control and treatment
alternated first position across paired blocks.

The planned campaign sizes were:

- calibration: one excluded task per condition;
- prespecified minimum pilot: 6 tasks × 2 conditions × 2 repeats = 24 runs;
- preferred pilot: 8 tasks × 2 conditions × 3 repeats = 48 runs.

### Account and runner safeguards

The pilot used subscription authentication, with no API-key billing, purchased
or promotional credits, alternate provider, or paid judge. Authentication
material remained outside the task repository and Pier uploaded it only to the
trial's temporary Codex home.

The runner rejected API-key authentication, provider or base-URL overrides, a
different Codex version, and runs without operator confirmation that automatic
credit top-up was disabled. These safeguards captured the conditions of this
campaign; they are not universal requirements for independent studies.

## Methodology

The primary outcome was the DeepSWE deterministic verifier pass indicator. The
primary effect was the treatment-minus-control paired risk difference. The
confidence interval came from a seeded nonparametric cluster bootstrap that
resampled task IDs while retaining all repeats for each sampled task.

Only complete, scorable control and treatment pairs entered the comparison. A
pair was excluded if either result lacked deterministic verifier output; no
missing result was imputed. If included subscription usage ended, the harness
attempted to finish the active pair, saved the campaign state, and stopped
before starting another pair.

Secondary outcomes were successful completion, wall-clock duration, agent
turns, input, cached-input and output tokens when reported by Codex, tool calls,
retries, and failure class. Efficiency was calculated both across all runs and
conditional on successful completion. Those values are identical in this pilot
because all 24 trials completed, although deterministic verifier failures still
counted against the primary outcome.

Secondary hypothesis families used Holm correction. A mixed-effects or GEE
model was complementary to the paired estimate and was used only when the
campaign had enough independent task clusters for a stable fit. Deterministic
verifiers assigned the primary score. Human adjudication was limited to
documented verifier or harness ambiguity and could not rewrite test results.

## Reproduction

Independent replications should record authentication and billing mode and hold
them constant between conditions. They must never silently change the model,
provider, or authentication method. Record the exact model, reasoning level,
CLI version, runner version, task locks, and plugin condition for every
campaign.

Check the frozen schedule without using model allowance:

```sh
npm run benchmark:plan -- --campaign minimum
```

For the subscription-backed v0.7 campaign, check the account safeguard and
record the plan-window state without account identifiers:

```sh
npm run benchmark:preflight -- \
  --confirm-auto-top-up-disabled \
  --plan-window-state included-usage-available-identifiers-omitted
```

Check out the DeepSWE and Pier commits from the lock, then run calibration:

```sh
npm run benchmark:run -- \
  --campaign calibration \
  --deepswe /absolute/path/to/deep-swe \
  --pier /absolute/path/to/pier \
  --confirm-auto-top-up-disabled \
  --plan-window-state included-usage-available-identifiers-omitted
```

Use `--resume` to continue the same campaign and `--max-pairs 1` for a bounded
smoke. Analyze exported JSON Lines records with:

```sh
npm run benchmark:analyze -- --records /absolute/path/to/records.jsonl
```

The deterministic implementation and fixtures are in
`benchmarks/lib/pilot.mjs` and `test/benchmark-pilot.test.mjs`.

## Data and privacy

Raw Pier jobs, Codex trajectories, runner logs, and patches remain outside the
tracked tree under `.git/zimster/benchmarks/`. Each job is stored as a
content-addressed `sha256/<digest>` bundle with a file inventory. The public
result contains the frozen manifest and lock hashes, run-level bundle hashes,
exclusions, failure classes, and analysis output. It contains no credentials,
account identifiers, authentication paths, or tokens.

## Future evaluation

Future campaigns will use the pilot's variance, runtime, and cost data to choose
task diversity, repeat count, and budget before another large run. The existing
evidence-sufficiency and cost-planning checks will guide that decision. More
unique tasks with fewer repeats may provide better information per Codex hour.
Superpowers, GSD, or another benchmark suite may be added when it answers a
specific evaluation question. Null and negative results will remain publishable.
