# Codex

Verification target for Zimster 0.7.1: `INSTALLED_PACKAGE_VERIFIED` on
standalone Codex CLI 0.147.0. The
managed Desktop runtime observed during release work was
0.147.0-alpha.6.6; it is separate evidence and exposed a smaller spawn schema.
Marketplace installation, generated-mirror integrity, and role-template parsing
are deterministic checks. A model-backed role/tool inventory remains a separate
live proof.

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

Codex supplies native Agent Skills, optional agents, and host-conditional
per-spawn model/reasoning settings. Current V2 exposes `spawn_agent`,
`send_message`, `followup_task`, `wait_agent`, `list_agents`, and
`interrupt_agent`; it does not expose V1's `close_agent`. Interrupt stops an
active turn but keeps the agent reusable, and `followup_task` starts another
turn on an idle agent.

## Reviewer role registration

The plugin manifest cannot register Codex agent roles. To claim a named
Zimster role, explicitly copy the desired files from
`templates/codex-agents/` into project `.codex/agents/` or personal
`$CODEX_HOME/agents/`, then start a fresh session. The templates apply a
read-only sandbox and disable both agent settings and multi-agent feature
flags. Zimster never edits personal configuration silently.

Some managed Desktop schemas do not expose `agent_type`, `model`, or
`reasoning_effort`. In those sessions a generic spawned agent is not proof that
a Zimster role was selected. Use dispatch/budget/depth reconciliation and fail
closed if role binding or descendant-tool removal cannot be observed. Requested
and effective model identity remain separate evidence.
