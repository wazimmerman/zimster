# Claude Code

## Verification status

Verification level: `STRUCTURALLY_VALIDATED`. The Claude package is validated against the primary plugin,
hook, subagent, worktree, and marketplace documentation accessed on 2026-07-27.
The Claude CLI is unavailable in the current development environment, so
plugin loading, discovery, installation, resume, and compaction are not claimed
as live verified.

Run Zimster’s dependency-free contract check:

```text
npm run validate:claude
```

The GitHub marketplace source is `wazimmerman/zimster`. Plugin agent defaults
inherit model and effort. `adapter-config.mjs generate --harness claude` can
stage same-name project `.claude/agents/` or user overrides only at an explicit
output when routing mode is `map_only` or `auto_within_policy`; `recommend` and
`inherit` generate no enforced override. The generated registry makes
rollback/removal ownership-safe.

When Claude Code is installed, also run its authoritative validator from the
repository or extracted Claude archive:

```text
claude plugin validate .
```

## Isolated local development

Keep experiments out of the normal Claude configuration. Set
`CLAUDE_CONFIG_DIR` to a new temporary directory and load the checkout for one
session:

```text
CLAUDE_CONFIG_DIR=<new-temporary-directory> claude --plugin-dir /absolute/path/to/zimster
```

Confirm that `/help` exposes namespaced Zimster skills, the agent list contains
the Zimster reviewers, and debug output contains no manifest, agent, or hook
warnings. Invoke `/zimster:using-zimster` for a read-only routing smoke.

For a complete isolated marketplace installation:

```text
CLAUDE_CONFIG_DIR=<new-temporary-directory> claude plugin validate /absolute/path/to/zimster
CLAUDE_CONFIG_DIR=<new-temporary-directory> claude plugin marketplace add /absolute/path/to/zimster
CLAUDE_CONFIG_DIR=<new-temporary-directory> claude plugin install zimster@zimster
```

## Update, reload, and removal

The manifest version is the Claude cache identity, so every release bumps it.
Refresh the local marketplace, reinstall/update the versioned plugin, and start
a fresh session:

```text
CLAUDE_CONFIG_DIR=<same-isolated-directory> claude plugin marketplace update zimster
CLAUDE_CONFIG_DIR=<same-isolated-directory> claude plugin install zimster@zimster
```

In an interactive session, `/reload-plugins` applies installed changes without
a restart. Remove only the isolated test installation with:

```text
CLAUDE_CONFIG_DIR=<same-isolated-directory> claude plugin uninstall zimster@zimster
CLAUDE_CONFIG_DIR=<same-isolated-directory> claude plugin marketplace remove zimster
```

## Session bootstrap

`hooks/hooks.json` registers one synchronous `SessionStart` command for
`startup`, `resume`, `clear`, and `compact`. The plugin-relative Node hook emits
one compact `using-zimster` context object, no stderr, and no progress message
on success without selecting Bash, PowerShell, or another platform shell.
Missing required bootstrap content exits nonzero with an actionable error. The
hook does not write state or modify user configuration.

## Reviewer enforcement

- `zimster-integration-reviewer` exposes only `Read`, `Grep`, and `Glob`;
  `Write`, `Edit`, `NotebookEdit`, `Bash`, and nested `Agent` delegation are
  explicitly denied. Its portable plugin definition uses `model: inherit`,
  omits effort, and allows at most 24 turns. Explicitly generated project/user
  definitions may select a mapped model and effort.
- `zimster-test-reviewer` exposes read/search plus Bash for one named probe.
  Claude runs it with `isolation: worktree`; write/edit and nested delegation
  are explicitly denied. Its assignment must name the command, artifact or
  output contract, and stop condition, and it must run the before/after
  checkout-integrity guard. Because Claude may create the worktree from the
  default branch, probes accept committed ranges only and detach the temporary
  worktree to the supplied immutable head before capture. The root conversation
  separately guards the persistent owner checkout.

Claude technically enforces the declared tool restrictions and worktree
isolation. The prompt still constrains the exact Bash command set, so a
tree-integrity violation remains an actionable failure rather than an expected
fallback.
