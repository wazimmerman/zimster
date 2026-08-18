# Kimi Code

The 0.7.2 PR matrix is the only current candidate claim. When the Kimi CLI is
`UNAVAILABLE`, only the current official manifest contract, canonical skill
paths, and single `sessionStart.skill` can be `STRUCTURALLY_VALIDATED`.
Managed installation, discovery, descendant restrictions, and model-backed
execution remain unavailable evidence.

## Install

From Kimi Code's interactive UI:

```text
/plugins install /absolute/path/to/zimster
/plugins info zimster
/plugins reload
```

The primary npm package and repository include `.kimi-plugin/plugin.json`.
Kimi copies local installations into its managed plugin directory; later source
edits require reinstalling. Third-party installation requires an explicit trust
decision.

## Update

Reinstall the new version, then use `/plugins reload` or start a new session.

## Remove

Use `/plugins remove zimster` to remove the installation record. Kimi may retain
the managed copy; `/plugins info zimster` distinguishes retained files from an
enabled installation.

## Diagnostics

Use `/plugins info zimster` and `/plugins reload`. Because the CLI was absent,
any Kimi-specific loading problem remains `UNAVAILABLE` release evidence until
reproduced with the documented host.

## Verification status

Only manifest and skill structure are `STRUCTURALLY_VALIDATED`. Installation,
fresh-session discovery, and model-backed behavior are not release claims.

Zimster maps only to Kimi's symbolic `primary`, a host-verified experimental
`secondary`, or inheritance. Vendor model IDs are not stored in the manifest.
Unsupported reviewer or routing controls remain explicit fallbacks.
