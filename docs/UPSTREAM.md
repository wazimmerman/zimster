# Upstream Reuse and Provenance

## Superpowers

- Repository: https://github.com/obra/superpowers
- Version used for initial adaptation: v6.2.0
- License: MIT
- Copyright: Copyright (c) 2025 Jesse Vincent

The full notice is preserved in `THIRD_PARTY_NOTICES.md`.

### Adapted material

| Zimster file | Superpowers source | Treatment |
|---|---|---|
| `hooks/run-hook.cmd` | `hooks/run-hook.cmd` | cross-platform wrapper adapted |
| `hooks/session-start` | `hooks/session-start` | injects only `using-zimster` |
| Claude hook manifest | matching upstream file | structure adapted to the current Claude contract |
| OpenCode/Pi adapters | matching upstream adapters | discovery/cache/bootstrap adapted |
| harness manifests | upstream manifests | layouts adapted, then each retained manifest corrected to its current primary contract; the unsupported Cursor manifest/hook were removed |
| TDD/verification/worktree/review/finish skills | corresponding skills | safety mechanisms compressed and redesigned around persistent ownership |

### Retained mechanisms

Verified RED, root-cause debugging, isolation, independent review, evidence
before completion, durable file handoffs, model-aware delegation, circuit
breakers, and explicit blocked states.

### Deliberate departures

Material-risk skill selection, vertical slices, one persistent owner,
seam-triggered review, one resumed recheck, prohibited nesting, and first-class
agent/test/turn/token economics.

## OpenAI Codex plugin contract

Zimster includes a compact JavaScript port of current plugin-ingestion checks
from the official `openai/codex` plugin-creator skill:

- Repository: https://github.com/openai/codex
- Source paths: recorded in
  `vendor/openai-codex-plugin-validator/manifest-contract.json`
- Pinned validator blob:
  `88fae0fd00998ea32fa2393869042f0231a2b43b`
- License: Apache License 2.0

The port validates accepted manifest fields, interface metadata, skill
frontmatter, relative assets, and the repo marketplace's local
`./plugins/zimster` source. It is not represented as a live Codex ingestion
test. Source provenance and the Apache license are vendored alongside the
contract snapshot.

## Maintenance

The weekly Superpowers audit treats a new upstream release as a review signal,
not an automatic merge. Codex contract snapshots should likewise be refreshed
only after comparing official creator/validator source, updating provenance,
observing RED against the old contract, and validating the new package layout.
Cursor, Kimi Code, OpenCode, Pi, and Claude contract decisions and access dates
are recorded in `RESEARCH.md`; their primary documentation must be rechecked
before adding or retaining fields.
