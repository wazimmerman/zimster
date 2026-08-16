# Kimi Code

Verification target for Zimster 0.7.1: Kimi Code 0.36.1. The native manifest
uses documented fields, canonical skill paths, exactly one
`sessionStart.skill`, and plugin-discovered agent files. Managed installation,
discovery, and model-backed execution remain separately scoped evidence.

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

Use `/plugins info zimster` and `/plugins reload`. `sessionStart.skill` applies
to new and resumed sessions, while a changed local source directory does not
affect Kimi's managed copy until reinstall/reload.

## Verification status

Manifest, skill, and agent structure are `STRUCTURALLY_VALIDATED` on 0.36.1.
Installation, fresh-session discovery, and model-backed behavior require their
own receipts.

Zimster maps only to Kimi's symbolic `primary`, a host-verified experimental
`secondary`, or inheritance. Vendor model IDs are not stored in the manifest.
Unsupported reviewer or routing controls remain explicit fallbacks.

Kimi supports nested `Agent` and high-fanout `AgentSwarm`; prompt text alone is
not a restriction. Every packaged Zimster agent declares `subagents: []`, which
Kimi re-checks for both dispatch tools. Use a named packaged role when claiming
that enforcement. A generic built-in agent remains outside that claim and must
be detected through assurance accounting.
