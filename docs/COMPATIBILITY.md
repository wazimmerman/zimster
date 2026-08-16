# Compatibility

Zimster 0.7.1 separates portable workflow guidance from host-native features.
The canonical contract is root `plugin.json` plus `skills/`. Host overlays add
installation, bootstrap, agents, or lifecycle behavior without redefining the
canonical skills.

Status vocabulary:

- `LIVE_VERIFIED`: the named behavior was observed with the listed CLI and
  isolated configuration on 2026-08-16.
- `INSTALLED_PACKAGE_VERIFIED`: installation and package inventory passed, but
  fresh model-backed execution was not run.
- `STRUCTURALLY_VALIDATED`: schemas and dependency-free fixtures passed.
- `UNAVAILABLE`: the CLI or required capability was absent.

| Host | CLI | Distribution | Verified capabilities | Not established |
|---|---:|---|---|---|
| Codex | standalone 0.147.0; managed Desktop 0.147.0-alpha.6.6 | Codex zip / Git marketplace | `INSTALLED_PACKAGE_VERIFIED`: marketplace registration, install, version, generated-mirror integrity; explicit role templates parse in a project layer | Authenticated exact-package prompt task; managed Desktop role binding because its observed schema omitted role/model/effort fields |
| Claude Code | 2.1.233 | Claude zip / GitHub marketplace | `STRUCTURALLY_VALIDATED`: current strict validator covers exact-package manifest, 12 skills, 4 agents, and 1 SessionStart hook | Isolated authenticated model-backed invocation and effective restriction observation |
| Grok | 1.0.0 stable | Portable Agent Plugin zip | `STRUCTURALLY_VALIDATED`: root Agent Plugins manifest and 12-skill package structure | Isolated installation, fresh discovery, and model-backed invocation; no separate `.grok` layer was needed |
| OpenCode | 1.18.18 | npm tarball / project package | `LIVE_VERIFIED`: exact npm tarball extraction, project adapter load, canonical skill discovery | Model-backed task execution and effective model identity |
| Pi | 0.84.2 | `zimster` npm package | `INSTALLED_PACKAGE_VERIFIED`: local package installation and listing; structural extension/resource tests | Model-backed session discovery; optional `pi-subagents` 0.50.0 transport execution |
| Kimi Code | 0.36.1 | `zimster` npm package / local plugin source | `STRUCTURALLY_VALIDATED`: native manifest fields, skill paths, agent discovery contract, one session bootstrap, and `subagents: []` restrictions | Managed-copy discovery, authenticated model-backed execution, and effective restriction observation |

These claims are capability-specific. For example, Claude component inventory
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
  optional through the tested 0.50.0 event-contract boundary.
- Kimi uses `.kimi-plugin/plugin.json` because its native managed-plugin
  contract adds session bootstrap behavior.

Host versions and behavior change. Re-run the isolated commands in each host
guide before broadening a release claim.
