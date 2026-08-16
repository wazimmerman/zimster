# Kimi Code

Verification achieved for Zimster 0.7.1: `INSTALLED_PACKAGE_VERIFIED` on Kimi
Code 0.36.1. In an isolated `KIMI_CODE_HOME`, the current local-plugin flow
copied the exact candidate into Kimi's managed directory. After reload,
`/plugins info zimster` reported Zimster 0.7.1 enabled with healthy state,
`using-zimster` as the session start, and skill instructions present.
Model-backed execution was unavailable because no provider was configured.

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

The exact candidate is `INSTALLED_PACKAGE_VERIFIED` on 0.36.1. Managed-copy
installation, reload, manifest health, session-start discovery, and skill
instructions were observed. Model-backed behavior and effective runtime tool
restriction remain unverified.

Zimster maps only to Kimi's symbolic `primary`, a host-verified experimental
`secondary`, or inheritance. Vendor model IDs are not stored in the manifest.
Unsupported reviewer or routing controls remain explicit fallbacks.

Kimi supports nested `Agent` and high-fanout `AgentSwarm`; prompt text alone is
not a restriction. Every packaged Zimster agent declares `subagents: []`, which
Kimi re-checks for both dispatch tools. Use a named packaged role when claiming
that enforcement. A generic built-in agent remains outside that claim and must
be detected through assurance accounting.
