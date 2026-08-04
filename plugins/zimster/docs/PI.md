# Pi

## Install

Pi recognizes the `pi` resource declaration in `package.json`. Install the
package from Git with:

```text
pi install git:github.com/wazimmerman/zimster
```

For an isolated trial, use `pi -e /absolute/path/to/zimster`. Pi loads the
TypeScript extension and the packaged `skills/` directory. Pi packages execute
with full system access, so review the source before installation.

## Update

Use `pi update git:github.com/wazimmerman/zimster` for this package or
`pi update --extensions` for all unpinned packages. A pinned tag or commit does
not advance during a general update; install the new pinned source explicitly.

## Remove

Use:

```text
pi remove git:github.com/wazimmerman/zimster
```

Add `-l` to install or remove project-local package state instead of user state.

## Diagnostics

Use `pi list` to inspect installed packages and `pi config` to inspect enabled
resources. From the package, run `npm run validate:adapters` and
`npm run doctor -- --json`. The extension registers the skills directory and
inserts the compact bootstrap at most once per active context.

## Verification status

Verification level: `STRUCTURALLY_VALIDATED`. The package declaration and TypeScript extension are validated.
The extension factory, resource discovery, and duplicate-injection guard run in
a dependency-free Node 22 smoke fixture. The Pi CLI was unavailable, so package
installation and a model-backed session were not live-tested.

Zimster ships no Pi subagent runtime, so the owner executes inline by default.
`pi --list-models` may supply catalog evidence for external extensions, but
Zimster neither installs nor trusts them. Independent review is unavailable
unless the active Pi setup supplies a qualifying separate context; no Pi live
or model-backed claim is made for 0.6.0.
