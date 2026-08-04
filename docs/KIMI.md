# Kimi Code

## Install

Install the repository or an extracted portable package with Kimi Code's
`/plugins install` command. The native `.kimi-plugin/plugin.json` points to the
packaged `skills/` directory and injects only `using-zimster` at session start.
No second bootstrap hook is registered.

## Update

Kimi Code manages a copied plugin under its managed plugin directory. Reinstall
the newer source with `/plugins install`, then use `/plugins reload` or start a
fresh session. Reinstallation is required for changes in the source checkout to
reach the managed copy.

## Remove

Use `/plugins remove zimster`. Kimi Code may retain its managed copy as an
installation record; use `/plugins info zimster` to distinguish an installed
plugin from retained files.

## Diagnostics

Use `/plugins info zimster` and `/plugins reload` in Kimi Code. From the package,
run `npm run validate:adapters` and `npm run doctor -- --json`. Unsupported
manifest fields are treated as package errors; expected unavailable reviewer
controls are quiet capability fallbacks.

## Verification status

Verification level: `STRUCTURALLY_VALIDATED`. Validated against the current Kimi plugin schema. The manifest uses
only documented fields and exactly one `sessionStart.skill`. The Kimi CLI was
unavailable, so managed installation, skill discovery, and session behavior
were not live-tested.

Routing maps only to Kimi's symbolic `primary`, verified experimental
`secondary`, or inheritance. `secondary` is unavailable unless the active host
reports that mode; vendor model IDs never enter the plugin manifest. This
surface remains experimental and is not included in the live 0.6 support claim.
