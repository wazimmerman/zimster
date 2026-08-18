# Claude Code

Verification level for Zimster 0.7.0: `STRUCTURALLY_VALIDATED` for the exact
package manifest, 12 skills, 4 agents, and 1 SessionStart hook on the Claude
Code 2.1.224 validation surface. Isolated installation, fresh discovery, and
authenticated model-backed invocation are not established by the release
receipt.

## Validate and install

Use a new temporary `CLAUDE_CONFIG_DIR` for all commands:

```text
claude plugin validate /absolute/path/to/zimster
claude plugin marketplace add /absolute/path/to/zimster
claude plugin install zimster@zimster
claude plugin list --json
claude plugin details zimster@zimster
```

The Claude zip contains `.claude-plugin`, agents, hooks, canonical skills, and
the package-root helpers. GitHub users may add `wazimmerman/zimster` instead of
a local path.

## Update and remove

```text
claude plugin marketplace update zimster
claude plugin update zimster@zimster
claude plugin uninstall zimster@zimster
claude plugin marketplace remove zimster
```

Restart after updates. The manifest version is part of Claude's cache identity.

## Native overlay

`hooks/hooks.json` registers one synchronous, idempotent SessionStart hook for
startup, resume, clear, and compact. It emits the `using-zimster` bootstrap and
does not write project or user state.

The `integration-reviewer` is read/search-only. The `test-reviewer` adds bounded
shell access and worktree isolation for one named probe. These declarations and
their validators are verified structurally; this release does not claim that a
model-backed session proved every effective restriction.
