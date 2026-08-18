# Codex

The 0.7.2 PR matrix is the only current candidate claim. Qualify the exact
Codex archive separately on the stable standalone CLI and the desktop-managed
runtime. Installation and skill discovery can establish
`INSTALLED_PACKAGE_VERIFIED`; they do not establish effective role/model
identity, reviewer enforcement, or model-backed workflow quality.

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
