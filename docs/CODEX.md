# Codex Installation, Updates, and Validation

Status on 2026-07-27: the complete marketplace package was live-installed with
Codex CLI 0.145.0 in an isolated `CODEX_HOME`. Marketplace registration,
installation, cache materialization, and the current official plugin validator
all succeeded. A fresh `codex exec` session did not receive the installed
`using-zimster` skill context. This is recorded as a host skill-discovery
blocker, separate from package validity and installation success.
The 0.6.0 fresh-session beta claim is therefore blocked pending new live proof.

Normal Zimster runs do not warn about this expected fallback. `npm run doctor`
reports the detailed host/capability state.

## Adaptive routing

After delegation is independently selected, prefer an explicit per-spawn model
and reasoning effort. If unavailable, generate a role config to an explicit
staging path and reference it from `[agents.<role>].config_file`; otherwise
inherit. Catalog output is session-scoped evidence. Strict cost requires both
enforcement and effective-model reporting; Zimster never edits active Codex
user configuration.

## Validate the complete package

From the repository root:

```text
npm run sync:codex:check
npm run validate:codex
python3 <codex-plugin-creator>/scripts/validate_plugin.py plugins/zimster
npm run package
```

`validate:codex` uses the pinned JavaScript contract derived from OpenAI's
official validator. The direct Python command is the authoritative live
validator when the current Codex plugin-creator skill is installed.

## Isolated local installation

Create a temporary Codex home using the native temporary-directory facility on
your operating system, then set `CODEX_HOME` only for the smoke-test process.
Do not point the smoke at your normal Codex home.

```text
codex plugin marketplace add /absolute/path/to/zimster
codex plugin list
codex plugin add zimster@zimster --json
```

All three commands must run with the same isolated `CODEX_HOME`. Validate the
`installedPath` returned by the JSON install result, not merely the canonical
source directory. A complete smoke distinguishes:

1. package validation;
2. marketplace registration;
3. plugin installation and cache materialization;
4. fresh-session skill discovery.

Failure at step 4 does not retroactively invalidate steps 1–3.

## Local update and reinstall

Codex caches plugins by version. Prepare an isolated marketplace copy, then
replace the cachebuster on that copy:

```text
npm run codex:cachebuster -- /path/to/staging/plugins/zimster
codex plugin add zimster@zimster --json
```

The helper preserves the semantic release version and writes exactly one
`+codex.<cachebuster>` suffix. Re-running it replaces the suffix instead of
stacking suffixes. Start a new Codex task after reinstall so skills and tools
are discovered from the new cache entry.

## Public marketplace installation and updates

For a cloned Zimster marketplace:

```text
codex plugin marketplace add /absolute/path/to/zimster
codex plugin add zimster@zimster
```

For a configured Git marketplace, refresh it with:

```text
codex plugin marketplace upgrade zimster
codex plugin add zimster@zimster
```

The repository marketplace path is
`.agents/plugins/marketplace.json`; its local entry resolves to
`./plugins/zimster` relative to the marketplace root. The installable package
is never the repository root.

## Removal and diagnostics

```text
codex plugin remove zimster@zimster
codex plugin marketplace remove zimster
npm run doctor
```

Removal commands mutate the selected `CODEX_HOME`; verify that an isolated or
intended user home is selected before running them.
