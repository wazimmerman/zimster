# Claude Code

Exact-final verification for Zimster 0.7.1 is `STRUCTURALLY_VALIDATED` on
Claude Code 2.1.226. Strict validation covered the exact Claude archive's 12
skills, 4 agents, one SessionStart hook, and package manifest. An earlier
isolated 2.1.233 marketplace install used an older candidate and is historical
context, not authorization for the final artifact. Marketplace installation
and authenticated model-backed invocation remain unverified for the final
candidate.

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

Since 2.1.232, interactive fork mode and background defaults can preserve more
parent context and capabilities than older guidance assumed. A fork retains the
parent tool pool; `-p` and SDK defaults differ. Claude now supports nested
subagents, so Zimster does not rely on a host-wide no-nesting assumption. Every
packaged Zimster role mechanically withholds `Agent` through an allowlist or
`disallowedTools: Agent`; exercise that denial before broadening a live claim.
`SendMessage` can steer or resume a completed agent by identity, so the bounded
correction recheck must resume the same recorded reviewer rather than spawn a
near-synonymous replacement.
