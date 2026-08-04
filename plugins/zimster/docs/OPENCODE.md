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

Verification level: `LIVE_VERIFIED`. The dependency-free adapter is validated
on Node 22, and the exact 0.6.0 portable archive passed isolated OpenCode
configuration and skill discovery. The receipt does not establish model-backed
prompt execution, effective-model identity, or separately documented v2-only
behavior.

Optional generated agents use OpenCode's `provider/model-id` syntax. An omitted
model inherits from the invoking primary agent, and `opencode models` is only
session-scoped catalog evidence. Prefer current permission fields over
deprecated tool booleans. The exact host version and receipt freshness are
reported by `doctor -- --json`.
