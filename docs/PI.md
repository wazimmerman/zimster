# Pi

Verification target for Zimster 0.7.1: `INSTALLED_PACKAGE_VERIFIED` on Pi 0.84.2.
An isolated local package install and `pi list` succeeded. Dependency-free
tests verify the extension factory, declared skill resources, duplicate
bootstrap guard, and delegation fallback. Model-backed discovery was not run.

## Install

The primary `zimster` npm package is the Pi package:

```text
pi install npm:zimster
pi list
```

For a local candidate, use `pi install /absolute/path/to/extracted/package`.
Set `PI_CODING_AGENT_DIR` to a new temporary directory and `PI_TELEMETRY=0` for
an isolated smoke. Pi packages execute with full system access, so inspect the
source before installation.

## Update

```text
pi update --extensions
```

Use `-l` for project-local settings. Start a fresh session after changing
package resources.

## Remove

```text
pi remove npm:zimster
```

Remove only the Zimster package record. Preserve unrelated Pi settings and
packages.

## Diagnostics

Run `pi list` with the same isolated `PI_CODING_AGENT_DIR`. Confirm the package
source and inspect startup diagnostics before attributing behavior to Zimster.

## Verification status

Exact npm-package installation targets Pi 0.84.2.
Fresh model-backed discovery and the optional delegation transport remain
unverified.

## Optional delegation

Owner-inline execution is the default. `.pi/delegation.ts` bridges the supported
`pi-subagents/delegation` request/response/cancel event contract from optional
`pi-subagents` 0.50.0. It correlates stable request/owner/node identities, caps
active owned leaves at two, rejects nonzero requested depth, and preserves
terminal/cancellation states. Zimster never installs that transport silently;
missing or incompatible event transport returns `inline_required`.

The bridge does not turn a prompt into a sandbox and does not prove that a
selected Pi agent lacks its own delegation tools. Use restricted configured
agents where available and require Zimster's agent/depth accounting receipt;
observed descendant activity invalidates completion.

`pi --list-models` is session-scoped catalog evidence, not proof of effective
model routing.
