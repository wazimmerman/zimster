# Grok

The 0.7.2 PR matrix is the only current candidate claim. Native validation,
isolated installation, and `grok inspect --json` skill inventory can establish
`INSTALLED_PACKAGE_VERIFIED`; model-backed execution requires a separate smoke
against that same exact portable archive.

Grok accepts the standards-based root `plugin.json`. Its validator selected the
root manifest and found the canonical `skills/` directory, so Zimster does not
ship a separate `.grok` overlay.

## Install

From an extracted portable zip or a repository checkout:

```text
grok plugin validate /absolute/path/to/zimster
grok plugin install /absolute/path/to/zimster --trust
grok plugin list
grok plugin details zimster
```

Only use `--trust` after reviewing the package. For an isolated smoke, point
`GROK_HOME` at a new temporary directory for every command. `grok inspect
--json` should report the installed `zimster` plugin and all 12 skills.

## Update and removal

```text
grok plugin update zimster
grok plugin uninstall zimster
```

For a local-path installation, reinstall after replacing the extracted
artifact. Start a fresh session after an update.

## Capability mapping

Use Grok's native tools and Agent Skills. Zimster does not require Grok
subagents; if delegation is useful, keep one owner, prohibit nested subagents,
and cap parallel implementers at two. Native permissions, model choice, and
reasoning effort remain host/session configuration rather than portable plugin
claims.
