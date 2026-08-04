# Public-beta installation and lifecycle

Zimster 0.6.0 is a public beta. Use an isolated host home for the first install,
run diagnostics, then start a fresh host session. Installation does not by
itself prove skill discovery or model-routing enforcement.

## Codex Git/custom marketplace

Clone the repository, then register its marketplace and install the package:

```text
git clone https://github.com/wazimmerman/zimster.git
codex plugin marketplace add /absolute/path/to/zimster
codex plugin add zimster@zimster --json
```

The repository marketplace is `.agents/plugins/marketplace.json`; the package
is `plugins/zimster/`. For a configured Git marketplace, use `codex plugin
marketplace upgrade zimster` before reinstalling. See `CODEX.md` for isolated
`CODEX_HOME` validation and the current fresh-session limitation.

## Claude Code GitHub marketplace

Add the GitHub repository as a marketplace and install its plugin:

```text
claude plugin marketplace add wazimmerman/zimster
claude plugin install zimster@zimster
```

Use a temporary `CLAUDE_CONFIG_DIR` for smoke tests. The checked-in reviewer
agents inherit model and effort; optional generated project or user overrides
must be written to an explicit path with `adapter-config.mjs`.

## Skills-only installation

From a checkout or extracted portable archive:

```text
npm run sync-skills -- --target /path/to/project --dry-run
npm run sync-skills -- --target /path/to/project
```

Skills-only mode is portable but has no guaranteed helper scripts, generated
receipts, or host-specific model enforcement. See `SKILLS_ONLY.md`.

## Update

Fetch or extract the desired release, verify its checksum, refresh the host
marketplace, reinstall, and start a new session. Skills-only users rerun
`sync-skills` from the new package. Run `doctor -- --json` and exact-package
smoke after every update.

## Rollback

First set `routing.mode` to `inherit` and
`autonomous_convergence.enabled` to `false`. Remove only Zimster-owned generated
overrides using their `.zimster-generated.json` manifest. Then reinstall the
0.5.0 tag or archive and rerun its installed-package smoke. Historical dispatch
v1 records remain readable and are not rewritten.

## Uninstall

Use `codex plugin remove zimster@zimster` and optionally remove its marketplace,
or `claude plugin uninstall zimster@zimster` followed by marketplace removal.
For skills-only installs, remove only paths listed by the Zimster ownership
marker. Git-local run state under `git rev-parse --git-path zimster` is retained
unless the user explicitly chooses to delete it.
