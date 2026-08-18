# OpenCode

The 0.7.2 PR matrix is the only current candidate claim. Extract the exact npm
tarball under isolated config/data/cache/state paths. A clean
`opencode debug skill` result must show the Zimster skills without a plugin-load
error before the adapter is `INSTALLED_PACKAGE_VERIFIED`.

## Install

Use the primary npm package, which preserves `.opencode/plugins/zimster.js` and
`skills/` at the same package root. The portable Agent Plugin zip intentionally
does not carry the OpenCode overlay.

For project use, extract/copy the npm package into the project or install the
canonical skills under `.agents/skills/`. Restart OpenCode, then inspect:

```text
opencode debug config
opencode debug skill
```

The thin adapter registers the canonical skills and injects the compact
`using-zimster` bootstrap once.

## Update

Replace the complete package root, preserving relative paths, then restart.

## Remove

Remove only `.opencode/plugins/zimster.js` and Zimster-owned skill directories;
preserve unrelated host configuration.

## Diagnostics

Run `opencode debug config` and `opencode debug skill` under isolated XDG paths.
Verify that `using-zimster` resolves from the same extracted npm package as the
adapter.

## Verification status

Exact-package skill discovery can be `LIVE_VERIFIED` only for the commit and
tarball hash named by the current matrix. Model-backed task execution and
effective-model identity remain separate claims.

Optional generated agents use OpenCode's `provider/model-id` syntax. Omitted
models inherit. Catalog output is not proof of effective model identity.
