# Compatibility

Zimster separates portable workflow guidance from host-native features.
The canonical contract is root `plugin.json` plus `skills/`. Host overlays add
installation, bootstrap, agents, or lifecycle behavior without redefining the
canonical skills.

## 0.7.2 candidate qualification

The release-candidate PR records an exact-head, exact-artifact matrix with the
candidate commit, SHA-256 hashes, host versions, test date, verification level,
capabilities established, capabilities not established, and limitations. Only
observations against that exact build are current 0.7.2 claims. The accepted
0.7.0 runtime governs recovery; candidate helpers are isolated from that
governing boundary.

## Published 0.7.0 historical evidence

The table below is retained for audit only. It does not qualify a 0.7.2
candidate or substitute for final-candidate testing.

Historical status vocabulary:

- `LIVE_VERIFIED`: the named behavior was observed with the listed CLI and
  isolated configuration on 2026-08-07.
- `INSTALLED_PACKAGE_VERIFIED`: installation and package inventory passed, but
  fresh model-backed execution was not run.
- `STRUCTURALLY_VALIDATED`: schemas and dependency-free fixtures passed.
- `UNAVAILABLE`: the CLI or required capability was absent.

| Host | CLI | Distribution | Verified capabilities | Not established |
|---|---:|---|---|---|
| Codex | 0.146.1 | Codex zip / Git marketplace | `INSTALLED_PACKAGE_VERIFIED`: marketplace registration, install, version, generated-mirror integrity | Fresh isolated prompt discovery for the 0.7.0 archive; model-backed task execution |
| Claude Code | 2.1.224 | Claude zip / GitHub marketplace | `STRUCTURALLY_VALIDATED`: exact-package manifest, 12 skills, 4 agents, and 1 SessionStart hook structure | Isolated installation, fresh discovery, authenticated model-backed invocation, and effective model identity |
| Grok | 1.0.0 stable | Portable Agent Plugin zip | `STRUCTURALLY_VALIDATED`: root Agent Plugins manifest and 12-skill package structure | Isolated installation, fresh discovery, and model-backed invocation; no separate `.grok` layer was needed |
| OpenCode | 1.18.13 | npm tarball / project package | `LIVE_VERIFIED`: exact npm tarball extraction, project adapter load, canonical skill discovery | Model-backed task execution and effective model identity |
| Pi | 0.84.1 | `zimster` npm package | `INSTALLED_PACKAGE_VERIFIED`: local package installation and listing; structural extension/resource tests | Model-backed session discovery; optional `pi-subagents` transport execution |
| Kimi Code | unavailable | `zimster` npm package / repository | `STRUCTURALLY_VALIDATED`: native manifest fields, skill paths, and single session bootstrap | CLI installation, managed-copy discovery, and model-backed execution |

These historical claims are capability-specific. For example, Claude component inventory
does not prove that a reviewer restriction survived a model session, and
OpenCode skill discovery does not prove routing to a requested model.

## Portable baseline

Every host can consume the 12 canonical Agent Skills if it implements the
current Agent Skills format. The OpenAI and portable release bundles place the
referenced dependency-free runtime inside the `using-zimster` skill. A direct
source-tree skill copy may still lose helpers, and all skills-only installs lose
host agents/hooks and machine-enforced model settings. Every helper reference
therefore retains a manual or inline fallback.

## Native differences

- Codex uses the generated `plugins/zimster` mirror and OpenAI listing metadata.
- Claude adds agents and an idempotent SessionStart hook.
- Grok consumes the root standards manifest directly; validation and install
  did not justify an extra `.grok` overlay.
- OpenCode uses a thin project plugin to register the canonical skills.
- Pi uses package metadata and a TypeScript extension. Delegation remains
  optional through the narrow capability boundary.
- Kimi uses `.kimi-plugin/plugin.json` because its native managed-plugin
  contract adds session bootstrap behavior.

Host versions and behavior change. Re-run the isolated commands in each host
guide against one exact candidate before broadening a release claim.
