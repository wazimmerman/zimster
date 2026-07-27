# Upstream Reuse and Provenance

## Pinned source

- Project: Superpowers
- Repository: https://github.com/obra/superpowers
- Version used for this initial adaptation: v6.2.0
- License: MIT
- Upstream copyright: Copyright (c) 2025 Jesse Vincent

The full upstream notice is preserved in `THIRD_PARTY_NOTICES.md`.

## Adapted code

| Zimster file | Superpowers source | Treatment |
|---|---|---|
| `hooks/run-hook.cmd` | `hooks/run-hook.cmd` | adapted names/comments; cross-platform wrapper retained |
| `hooks/session-start` | `hooks/session-start` | adapted to inject only `using-zimster` |
| `hooks/hooks.json` | `hooks/hooks.json` | manifest structure adapted |
| `hooks/hooks-cursor.json` | same path | manifest structure adapted |
| `.opencode/plugins/zimster.js` | `.opencode/plugins/superpowers.js` | frontmatter parsing, cache, skill registration, and first-user-message bootstrap adapted |
| `.pi/extensions/zimster.ts` | `.pi/extensions/superpowers.ts` | resource discovery and compact bootstrap lifecycle adapted |
| plugin manifests | `.codex-plugin`, `.claude-plugin`, `.cursor-plugin`, `.kimi-plugin` manifests | schemas and packaging layout adapted |
| `test-driven-development` | `skills/test-driven-development/SKILL.md` | Iron Law and RED-GREEN-REFACTOR discipline compressed and extended with mutation proof |
| `verification-before-completion` | same-named skill | evidence-before-claims discipline adapted |
| worktree/review/finish skills | corresponding Superpowers skills | core safety principles rewritten for owner-driven execution |

## Retained mechanisms

- verified RED before production behavior;
- root-cause debugging and regression proof;
- repository isolation;
- independent review;
- evidence before completion;
- file-based durable state and handoffs;
- model-aware delegation;
- circuit breakers and explicit blocked states.

## Deliberate departures

- skills are selected by material risk rather than a one-percent applicability
  rule;
- planning uses vertical slices and proof obligations rather than 2–5 minute
  procedural actions;
- one persistent owner replaces a fresh implementer per task;
- review gates attach to risky seams rather than every task;
- one resumed recheck replaces fresh re-reviewer multiplication;
- subagent nesting is prohibited;
- agent, review, test, turn, and token economics are first-class evidence.

## Maintenance

The weekly upstream workflow runs `scripts/check-upstream.mjs`. A newer release
is a review signal, not an automatic merge. Evaluate security, portability,
harness compatibility, and measured workflow changes before adapting them.
