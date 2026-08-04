# Cursor

## Install

Cursor currently discovers project Agent Skills from `.agents/skills/` and
project commands from `.cursor/commands/`. From a Zimster checkout or extracted
portable package, install the current skills into a target repository:

```text
npm run sync-skills -- --target /path/to/project
```

Open that project in Cursor and ask it to use `using-zimster`. In a complete
Zimster checkout, the `using-zimster` project command provides the same entry
point. Zimster intentionally ships no `.cursor-plugin` manifest or Cursor
SessionStart hook because current Cursor documentation defines neither as a
repository plugin contract.

## Update

Run the same `sync-skills` command from the newer Zimster release. It replaces
only Zimster-managed skill files, removes stale Zimster skills, preserves
unrelated skills, and refreshes build metadata.

## Remove

Remove the Zimster-managed directories under `.agents/skills/`. Do not remove
unrelated skills. If the project copied `.cursor/commands/using-zimster.md`,
remove that one command separately.

## Diagnostics

Run `npm run doctor -- --json` in the Zimster package for capability details and
`npm run validate:adapters` for structural validation. A target repository can
inspect `.agents/skills/using-zimster/references/build-metadata.json` to identify
the synchronized version.

## Verification status

Structurally validated against the current Agent Skills and project-command
documentation. A Cursor CLI/application was unavailable, so loading and UI
behavior were not live-tested. Reviewer restrictions remain constrained by the
tools and agent controls selected in Cursor; Zimster does not claim a
plugin-enforced read-only reviewer or isolated worktree.

Concrete custom-agent model generation is public-beta and
`supported_with_constraints`: it is enabled only when the installed version
reports compatible fields. Otherwise routing inherits and effective model state
is `unverified`. Skills-only remains the installation source of truth.
