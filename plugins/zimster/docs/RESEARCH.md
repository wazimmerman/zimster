# Harness Contract Research and Design Lessons

Research access date: 2026-07-27 (America/Denver; some source timestamps use
2026-07-28 UTC). Project capabilities and licenses can change; verify the
linked primary sources before borrowing code or publishing claims.

## Supported harness contracts

| Harness | Primary sources | Local host | Supported capabilities | Unsupported or unverified | Implementation decision |
|---|---|---|---|---|---|
| Codex | [official plugin-creator skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/plugin-creator/SKILL.md), [manifest and marketplace sample](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md), official `validate_plugin.py`, and the plugin cachebuster/install reference bundled with Codex | `codex-cli 0.145.0` | Marketplace at `.agents/plugins/marketplace.json`; local source `./plugins/zimster`; self-contained skills/scripts/assets; CLI marketplace registration/install | Named plugin agents, per-agent tool/model/effort/turn controls, and reviewer worktree isolation are not part of the current plugin manifest contract | Keep `plugins/zimster/` self-contained, reject `hooks` and other unknown manifest fields, run the pinned equivalent contract plus the current official validator when available, use isolated `CODEX_HOME`, and cachebust then reinstall for updates. |
| Claude Code | [plugins reference](https://code.claude.com/docs/en/plugins-reference), [hooks](https://code.claude.com/docs/en/hooks), [subagents](https://code.claude.com/docs/en/sub-agents), [worktrees](https://code.claude.com/docs/en/worktrees), and [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) | CLI unavailable | Plugin agents support `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, and `isolation: worktree`; plugin-level `SessionStart` command hooks support startup/resume/clear/compact | Plugin-agent `permissionMode`, hooks, and MCP fields are ignored or rejected; live loading is unverified here | Ship a static read/search-only reviewer and a bounded shell-capable probe with the documented field subset. Keep SessionStart deterministic, idempotent, plugin-relative, and silent on success. |
| Cursor | [Agent Skills](https://cursor.com/docs/context/skills), [commands](https://docs.cursor.com/en/agent/chat/commands), [rules](https://cursor.com/docs), and [CLI](https://docs.cursor.com/en/cli/using) | CLI unavailable | `.agents/skills/<name>/SKILL.md`, `.cursor/skills/`, `.cursor/commands/*.md`, root `AGENTS.md`, and custom subagents | No official repository plugin manifest or lifecycle-hook contract was found; Zimster did not live-verify per-agent model/effort/turn or worktree enforcement | Remove the invented manifest/hook. Use synchronized `.agents/skills` as the install surface and one explicit project command as the source-checkout entry point. |
| Kimi Code | [skills](https://moonshotai.github.io/kimi-code/en/customization/skills), [plugins](https://moonshotai.github.io/kimi-code/en/customization/plugins.html), [agents](https://moonshotai.github.io/kimi-code/en/customization/agents.html), and [CLI](https://moonshotai.github.io/kimi-code/en/reference/kimi-command) | CLI unavailable | `.kimi-plugin/plugin.json`, plugin-contained skill paths, `sessionStart.skill`, hooks/commands, native skills, and isolated `KIMI_CODE_HOME` | Plugin-distributed custom reviewers and their effective restrictions are not live-verified; `repository` and `interface.capabilities` are not documented manifest fields | Keep the native plugin and one skill bootstrap, remove both unsupported fields, and avoid claims about reviewer enforcement until live-tested. |
| OpenCode | [agents](https://opencode.ai/docs/agents), [skills](https://opencode.ai/docs/skills), [plugins](https://opencode.ai/docs/plugins), and the [canonical repository](https://github.com/anomalyco/opencode) | `1.18.7`; isolated `debug config` and `debug skill` passed | Project plugins, registered skill paths, native agents, and permission controls | No native reviewer-worktree contract or model-backed prompt execution was verified | Keep the dependency-free adapter. Live-verify plugin loading and `using-zimster` discovery in isolated XDG directories with a local model catalog; retain in-process duplicate-injection and corruption tests. |
| Pi | [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), and [usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md) | CLI unavailable; Node 22 structural smoke passed | `package.json` `pi.extensions`/`pi.skills`, TypeScript extensions, lifecycle events, `pi install`/`update`/`remove`, and project-local `-l` scope | No native custom-agent manifest or per-agent model/effort/turn/worktree contract was verified | Ship one package extension plus native skills, fail on missing package content, and prove resource discovery and one marked bootstrap without claiming a live Pi session. |

Capability labels in diagnostics distinguish `live_verified`,
`structurally_validated`, `experimental`, and `blocked_by_host`; normal workflow
progress uses quiet fallbacks and stores the detailed capability state in local
receipts.

## Superpowers

Superpowers remains Zimster's strongest direct predecessor. Its most valuable
mechanisms are TDD, reproduction-first debugging, explicit plans, worktree
isolation, independent review, durable progress, and evidence-before-claims.
Its current releases have already reduced reviewer count, moved handoffs to
files, added model routing guidance, scoped re-reviews, and bounded fix loops.

Zimster differs at the architectural level: Superpowers still makes a fresh
implementer and review gate the normal unit for each plan task. Zimster keeps a
persistent owner and selects review by risk and seam. Superpowers code reused
in Zimster is listed in `UPSTREAM.md`.

## OpenSpec

Repository: `Fission-AI/OpenSpec`

OpenSpec's strongest idea is explicit separation between current system truth
and proposed changes, especially for brownfield work. Its change artifacts and
archive flow are useful complements to Zimster's compact mission contract.
Zimster should remain compatible with an OpenSpec repository rather than
compete by inventing another large specification store.

## GitHub Spec Kit

Repository: `github/spec-kit`

Spec Kit provides a clear constitution → specification → plan → tasks →
implementation path and broad agent integration. It is valuable when product
and policy detail must be formalized before code. Its task-oriented pipeline
can still become heavier than necessary for an already approved change, so
Zimster treats detailed specification as conditional rather than universal.

## Agent OS

Repository: `buildermethods/agent-os`

Agent OS focuses on project standards, context injection, and lightweight
spec shaping. Its newer direction explicitly acknowledges that frontier models
can handle more planning and orchestration themselves. That aligns closely
with Zimster: preserve durable standards and constraints, but do not rebuild
model capabilities as mandatory ceremony.

## BMAD Method

Repository: `bmad-code-org/BMAD-METHOD`

BMAD offers role-specialized agents, scale-adaptive planning, and several
workflow depths. It is comprehensive and can be useful for large greenfield or
organizational work. Its standing cast of roles is not Zimster's default;
Zimster borrows the idea of adaptive depth while avoiding automatic role and
context multiplication.

## Ralph-style loops

Representative repository: `snarktank/ralph`

Ralph's useful ideas are simple file/git memory, one small story per iteration,
and explicit circuit breakers. Fresh context can help long autonomous loops,
but repeated cold starts also rebuild repository understanding. Zimster uses
a compact durable ledger and circuit breakers while retaining a persistent
owner for tightly coupled work.

## GSD

Repository: `gsd-build/get-shit-done`

GSD emphasizes context engineering, structured state artifacts, optional
research, plan checking, verification, and parallel agents. Configurable
workflow depth is valuable. Zimster goes further by making agent and review
budgets policy invariants and by treating most specialist behavior as review
lenses rather than separate identities.

## Ruflo / Claude Flow

Repository: `ruvnet/ruflo`

Ruflo targets large multi-agent swarms, many specialized roles, MCP
integration, and self-learning coordination. It explores the opposite end of
the design space. It may fit workloads with large genuinely independent work,
but its swarm orientation and self-reported performance claims are not a basis
for Zimster's efficiency-first default.

## metaswarm

Repository: `dsifry/metaswarm`

metaswarm uses eighteen specialized agents, recursive orchestration, mandatory
TDD, and adversarial cross-model review. That can increase independent
scrutiny, but its topology resembles the orchestration growth Zimster is
intended to avoid. Zimster may borrow blind or adversarial final evaluation in
benchmarks, not a standing eighteen-agent workflow.

## Smithers

Package/project: `smithers-orchestrator` / Smithers

Smithers is not primarily a development methodology; it is a durable workflow
runtime. Its strongest ideas are crash recovery, SQLite-backed checkpoints,
human approvals, rewind/retry, concurrent independent steps, and adapters for
multiple coding harnesses. Those capabilities become valuable when a run must
survive for hours or days. Zimster should remain usable as a lightweight
plugin, but a future optional Smithers adapter could execute Zimster workflows
durably without moving that machinery into the default prompt path.

## Microsoft Conductor

Repository: `microsoft/conductor`

Conductor defines multi-agent workflows in version-controlled YAML and routes
them deterministically, without spending LLM tokens deciding which node runs
next. It is compelling for repeatable CI, review pipelines, and regulated or
auditable processes. It is less natural for exploratory implementation where
the next useful action depends on what the owner discovers. Zimster should
borrow deterministic budgets, explicit terminal states, and validated routing,
while keeping the root implementation loop adaptive.

## Trellis

Repository: `mindfold-ai/Trellis`

Trellis combines scoped project standards, task-centered context, persistent
workspace journals, and broad harness support. Its auto-injected relevant
specs are especially useful. Its default plan → implement subagent → verify
subagent loop is still more delegation-heavy than Zimster's owner-driven
default, but its scoped-context model is a strong interoperability target.

## Task Master

Repository: `eyaltoledano/claude-task-master`

Task Master is strong at turning product requirements into managed task graphs
and coordinating many provider backends. Its current license combines MIT with
a Commons Clause that restricts competing products. Zimster therefore includes
no Task Master code and should not make it a dependency. Conceptually, its task
tracking is useful for large backlogs but is not a replacement for coherent
implementation ownership.

## Recommendation

Zimster should interoperate with specification and task tools rather than absorb
their entire surface area. Its distinctive value is the execution kernel:

- smallest useful workflow;
- persistent owner;
- proof-first slices;
- bounded delegation;
- risk-adaptive review;
- convergent correction;
- explicit economic and verification accounting.
