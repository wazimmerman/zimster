# Pi

The 0.7.2 PR matrix is the only current candidate claim. An isolated install
from the exact npm tarball plus `pi list`, declared resource inspection, and
extension regressions can establish `INSTALLED_PACKAGE_VERIFIED`. Model-backed
discovery and optional delegation remain separate capabilities.

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
pi update npm:zimster
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

Exact npm-package installation is `INSTALLED_PACKAGE_VERIFIED` only for the
commit and tarball hash in the current matrix. Fresh model-backed discovery and
the optional delegation transport remain unverified unless separately tested.

## Optional delegation

Owner-inline execution is the default. `.pi/delegation.ts` exposes only
`probe`, `launch`, `status`, `cancel`, and `collect`. The current optional
`pi-subagents` transport does not provide a trustworthy local ownership and
terminal-state interface with which Zimster can mechanically enforce the
max-two-active boundary. Zimster therefore fails closed to `inline_required`
even when that transport is installed, and rejects nonzero nesting depth. It
does not advertise mechanically enforced Pi parallelism or install another
transport during this release.

`pi --list-models` is session-scoped catalog evidence, not proof of effective
model routing.
