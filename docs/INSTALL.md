# Installation and lifecycle

Zimster 0.7.0 is a portable release candidate. Verify the artifact checksum,
use an isolated host configuration for the first install, inspect discovered
components, and start a fresh session. Installation never implies model-backed
execution; see `COMPATIBILITY.md` for claim scope.

## Codex Git/custom marketplace

Use the Codex zip or repository marketplace:

```text
codex plugin marketplace add /absolute/path/to/zimster
codex plugin add zimster@zimster --json
codex plugin list
```

The repository marketplace is `.agents/plugins/marketplace.json`; its package
is the generated `plugins/zimster` mirror. Use one isolated `CODEX_HOME` for the
smoke. See `CODEX.md`.

## Claude Code GitHub marketplace

Use the Claude zip or repository:

```text
claude plugin validate /absolute/path/to/zimster
claude plugin marketplace add /absolute/path/to/zimster
claude plugin install zimster@zimster
claude plugin details zimster@zimster
```

Use one temporary `CLAUDE_CONFIG_DIR`. See `CLAUDE.md`.

## Grok portable plugin

Extract the portable Agent Plugin zip, then:

```text
grok plugin validate /absolute/path/to/zimster
grok plugin install /absolute/path/to/zimster --trust
grok plugin details zimster
```

Use a temporary `GROK_HOME`. See `GROK.md`.

## OpenCode npm/project package

Install or extract the primary npm package with `.opencode/` and `skills/`
preserved at the same root. From that root run `opencode debug skill` and check
for all Zimster skills. See `OPENCODE.md`.

## Pi npm package

```text
pi install npm:zimster
pi list
```

For a local release candidate, replace `npm:zimster` with the extracted npm
package path. Use `PI_CODING_AGENT_DIR` for isolation. See `PI.md`.

## Kimi Code native plugin

Use `/plugins install <path-or-url>`, then `/plugins info zimster` and
`/plugins reload`. The CLI was unavailable for the 0.7.0 smoke, so follow the
bounded claims in `KIMI.md`.

## Skills-only installation

The OpenAI submission zip and portable zip both contain canonical skills. From
a full checkout or npm package:

```text
npm run sync-skills -- --target /path/to/project --dry-run
npm run sync-skills -- --target /path/to/project
```

Without the helper, copy each `skills/<name>/` directory unchanged into a host's
documented Agent Skills directory. Skills-only mode has no guaranteed scripts,
receipts, agents, hooks, or model enforcement. See `SKILLS_ONLY.md`.

## Update

Fetch or extract the desired version, verify its checksum, use the host's
update/reinstall command, and start a fresh session. Re-run component discovery
and diagnostics after every update.

## Rollback

Set `routing.mode` to `inherit` and disable autonomous convergence before
rolling back. Remove only Zimster-owned generated overrides, reinstall the
previous signed artifact, and repeat its smoke. Git-local journal records are
versioned and are not silently rewritten.

## Uninstall

Use the host-native plugin/package removal command. Skills-only users remove
only paths recorded by the Zimster ownership marker. Git-local runtime state is
retained unless the user explicitly requests its deletion.
