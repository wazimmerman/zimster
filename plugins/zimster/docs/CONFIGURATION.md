# Configuration and model routing

Routing never causes delegation. Zimster first records whether a bounded role
materially improves the task. Only a selected delegation can produce an
advisory plan proposal and a fresh authoritative dispatch proposal.

## Locations and precedence

Highest precedence is an explicit dispatch override, then per-run `--config`,
Git-local project state from `git rev-parse --git-path zimster/config.json`, user
configuration, harness-native configuration, and parent inheritance. Per-run
configuration is snapshotted into Git-local run state.

User configuration is `$XDG_CONFIG_HOME/zimster/config.json` (or
`$HOME/.config/zimster/config.json`) on Linux,
`$HOME/Library/Application Support/Zimster/config.json` on macOS, and
`%APPDATA%\Zimster\config.json` on Windows. Zimster reads these files but never
edits active host or user configuration automatically.

## Modes, policies, and classes

Classes are `economy`, `balanced`, `expert`, and `inherit`; canonical defaults
contain no vendor model IDs. Modes are:

- `recommend`: report an available mapped recommendation but inherit at spawn;
- `map_only`: use only an explicitly mapped candidate;
- `auto_within_policy`: rank mapped, available candidates within policy;
- `inherit`: request no model or effort override.

Policies are `quality_first`, `balanced`, and `cost_optimized`. Quality-first
may move one class upward, balanced may use the proposed or next class, and
cost-optimized stays in class before inheriting. `strict_cost` is valid only
with cost-optimized. If enforcement and effective-model reporting cannot both
be proved, optional delegation returns to the owner and required independent
review becomes blocked pending one policy exception.

## Mappings and availability

Mappings live only in run, project, user, or harness-native configuration. Each
candidate declares `model`, optional `provider` and `effort`, policy ranks,
optional harness/version/capability constraints, and availability evidence.
Ties keep declaration order. Catalog evidence is session/version scoped; it is
not durable policy. Requested provider, model, and effort remain separate from
effective values and mismatch reporting.

Validate with `node scripts/model-routing.mjs validate-config --config <path>`.
Generate optional host overrides only to an explicit output with
`adapter-config.mjs generate`; removal requires the generated ownership
manifest and refuses modified files, symlinks, or collisions.

## Proposal lifetime and local evidence

Plan proposals are advisory forever. Dispatch proposals are authoritative for
one current physical session and one dispatch. Task signature, Git state,
configuration/mapping digests, harness/version, capabilities, catalog, or an
override change invalidates them; a replacement names the superseded proposal.
Local routing observations use exact categorical matching and require three
comparable samples before a summary appears. Summaries are advisory and cannot
rewrite mappings, rank candidates, or mutate policy.

## Autonomous convergence

`config/convergence.json` defines correction-commit, review-recheck,
final-verification, complete-suite, duplicate-command, and context-renewal
budgets. Existing installs can keep manual behavior with
`autonomous_convergence.enabled=false`. Ordinary deterministic, reversible,
in-scope failures continue within budget. Contradiction, material expansion,
sensitive decisions lacking authority, missing review, required approval, or
exhaustion escalates. Host permission and authorization prompts are never
bypassed.
