# Zimster

Zimster is a proof-first, owner-driven software-development workflow for
capable coding agents. It keeps the parts of disciplined agentic development
that earn their cost—design when decisions matter, RED-GREEN-REFACTOR,
systematic debugging, isolated branches, independent review, and fresh
verification—while removing task-count-driven orchestration.

The default is one persistent implementation owner working in coherent
vertical slices. Delegation is optional, bounded, and selected by risk.

## What Zimster retains from Superpowers

- RED-GREEN-REFACTOR and verified failing tests.
- Reproduction-first systematic debugging.
- Explicit plans for consequential multi-step work.
- Git worktree/branch isolation.
- Independent code review.
- Evidence before completion claims.
- Durable progress artifacts for long sessions.
- Cross-harness plugin adapters and deterministic packaging patterns.

## What Zimster changes

- One persistent owner instead of a fresh implementer for every plan task.
- Vertical slices instead of horizontal microtask layers.
- Review at risky architectural seams instead of after every heading.
- One finding batch, one consolidated correction wave, and one resumed recheck.
- At most two parallel implementation agents by default.
- No sub-subagents.
- Explicit token/turn/agent/test budgets.
- Honest completion states for code, integration, services, hardware, and human
  acceptance.

## Supported harnesses

| Harness | Status | Integration |
|---|---|---|
| Codex | Priority | Native skill plugin and Codex marketplace manifest; hooks explicitly disabled |
| Claude Code | Supported | Native skills and compact SessionStart bootstrap |
| Cursor | Supported | Skills and Cursor SessionStart hook |
| Kimi Code | Supported | Native skills and manifest tool mapping |
| OpenCode | Supported | Plugin adapter registers skills and injects bootstrap once |
| Pi | Supported | Extension registers skills and injects bootstrap |

The core skills are operating-system-neutral. Harness adapters are isolated so
they can evolve without rewriting the methodology.

## Local development

```text
npm install
npm run doctor
npm run check
```

The project has no runtime dependencies. Node 22 or newer is required for the
maintenance and packaging scripts.

### Codex

Use the repository or `dist/zimster-<version>-codex.zip` as a Codex plugin
source. The Codex manifest discovers `skills/` and declares `hooks: {}` to
avoid loading the Claude bootstrap hook. Enable Codex multi-agent support only
when you want bounded delegation; Zimster also works inline.

### Claude Code

For local development, run `claude --plugin-dir ./zimster` or pass the generated Claude ZIP to `--plugin-dir`, then invoke `/zimster:using-zimster`. After the repository is published, add the marketplace with `/plugin marketplace add wazimmerman/zimster` and install with `/plugin install zimster@zimster`. The packaged Claude archive contains `.claude-plugin/`, `skills/`, `agents/`, and `hooks/`.

### Other harnesses

Use `dist/zimster-<version>-portable.zip`. See `docs/PORTING.md` and the adapter
files for platform-specific installation and fallback behavior.

## Main workflow

```text
select smallest useful workflow
→ mission/design only when choices matter
→ concise vertical-slice plan
→ persistent owner
→ RED → GREEN → REFACTOR
→ risk-triggered seam review
→ one correction wave and one recheck
→ fresh final evidence
→ honest branch handoff
```

## Repository layout

```text
skills/                 harness-neutral workflow skills
agents/                 optional bounded Claude-style agent definitions
.codex-plugin/          Codex manifest
.claude-plugin/         Claude Code manifest and development marketplace
.cursor-plugin/         Cursor manifest
.kimi-plugin/           Kimi manifest and tool mapping
.opencode/              OpenCode adapter
.pi/                    Pi extension
hooks/                  Claude/Cursor compact bootstrap
scripts/                validation, doctor, deterministic packaging
third-party notices     attribution for adapted MIT material
```

## Licensing and provenance

Zimster is MIT-licensed. Selected code and workflow language are adapted from
Superpowers 6.2.0 under its MIT license. See `THIRD_PARTY_NOTICES.md` and
`docs/UPSTREAM.md`. Other projects discussed in `docs/RESEARCH.md` informed the
design but contributed no code.

## Project status

Version 0.1.0 is an initial public-quality implementation of the core workflow,
portable adapters, maintenance tests, deterministic packaging, and evaluation
scaffold. Behavioral superiority over other frameworks is a benchmark target,
not a claimed result; see `docs/EVALUATION.md`.
