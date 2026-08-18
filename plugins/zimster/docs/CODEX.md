# Codex

Verification level for Zimster 0.7.0: `INSTALLED_PACKAGE_VERIFIED` on Codex CLI
0.146.1. Isolated marketplace registration and installation reported version
0.7.0 and the expected installed path. The generated mirror and listing
contracts pass deterministic validation. A fresh isolated model-backed prompt
against the 0.7.0 archive has not yet been scored.

## Install and inspect

Use the full Codex zip or repository marketplace. Keep every command on the
same temporary `CODEX_HOME`:

```text
codex plugin marketplace add /absolute/path/to/zimster --json
codex plugin add zimster@zimster --json
codex plugin list
```

The marketplace resolves `.agents/plugins/marketplace.json` to
`plugins/zimster`. Never hand-edit that package: change canonical sources and
run `npm run sync:codex`.

## Validate

```text
npm run sync:codex:check
npm run validate:codex
npm run package
```

The JavaScript validator uses the pinned official Codex contract. When the
current official Python validator is available, run it against
`plugins/zimster` as an additional live check.

## Update and remove

```text
codex plugin marketplace upgrade zimster
codex plugin add zimster@zimster --json
codex plugin remove zimster@zimster
codex plugin marketplace remove zimster
```

Codex caches plugins by version. For unreleased local iteration only,
`npm run codex:cachebuster -- /path/to/staging/plugins/zimster` replaces one
cachebuster suffix without changing the release version.

## Capability mapping

Codex supplies native Agent Skills, explicit per-run model/reasoning settings,
and optional agents. Requested and effective model identity remain separate
evidence. Zimster never edits active user configuration and never treats
installation as proof of model-backed behavior.
