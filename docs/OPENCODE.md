# OpenCode

## Install

Use the portable archive as a project package, preserving
`.opencode/plugins/zimster.js` and `skills/` at their packaged relative paths.
OpenCode discovers the project adapter, which registers the packaged skills
directory and adds the compact `using-zimster` bootstrap once to the first user
message.

## Update

Replace the project package with the newer portable release while preserving
its relative layout, then start a fresh OpenCode session. Do not copy the
adapter without its sibling `skills/` directory.

## Remove

Remove `.opencode/plugins/zimster.js` and the Zimster-managed skills. Preserve
all unrelated OpenCode plugins and Agent Skills.

## Diagnostics

From the project root, use `opencode debug config` to inspect loaded project
configuration and `opencode debug skill` to inspect discovered skills. Package
maintainers can run `npm run validate:adapters` and
`npm run doctor -- --json`. A missing required Zimster skill is an installation
error; unavailable reviewer isolation or effort controls are capability
fallbacks.

## Verification status

The dependency-free adapter is structurally validated and tested on Node 22. OpenCode
`1.18.7` is available locally; the release smoke records the exact portions of
configuration and skill discovery that this installed version can verify. The
installed version predates the separately documented v2 plugin contract, so
Zimster does not claim v2-only behavior or model-backed prompt execution.

Optional generated agents use OpenCode's `provider/model-id` syntax. An omitted
model inherits from the invoking primary agent, and `opencode models` is only
session-scoped catalog evidence. Prefer current permission fields over
deprecated tool booleans. Local 1.18.9 requires fresh exact-package proof.
