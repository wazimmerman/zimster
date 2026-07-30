# Skills-only installation

A skills-only installation preserves Zimster's workflow policy without
requiring plugin-relative helper scripts. From a Zimster checkout or extracted
portable release, synchronize into a target Git repository:

```text
npm run sync-skills -- --target /path/to/project
```

Preview the exact changes first when desired:

```text
npm run sync-skills -- --target /path/to/project --dry-run
```

The command is implemented with Node filesystem APIs and works on Windows,
macOS, and Linux. It validates that the target is a Git worktree, copies the
current skill set transactionally, removes stale Zimster-owned skills, refuses
unowned name collisions, preserves unrelated skills, and adds only a local Git
exclusion. It does not edit the target's tracked `.gitignore`.

## Installed version

Read this file in the synchronized target:

```text
.agents/skills/using-zimster/references/build-metadata.json
```

It records schema version, semantic version, source commit when available,
build date or reproducible build identity, and package target. Do not infer the
installed Zimster version from the target project's `package.json` or Git
history.

## Script-free operation

When no Zimster `scripts/` directory is installed, generated receipts are
unavailable. This is an expected quiet fallback, not an error. The owner still
applies branch safety, meaningful RED-GREEN-REFACTOR, complete staged/unstaged/
untracked review, integrity-aware independent review, and fresh canonical final
verification. Maintain compact durable state manually when its deterministic
triggers apply.

When scripts are absent, preserve the semantic contracts manually: stable
requirement IDs, a requirement-to-evidence matrix, proof-bounded intended
claims, explicit `self_review` versus `independent_review`, and separate
checkout-integrity versus semantic verdicts. State that generated validation
and completion receipts are unavailable; do not invent `CANDIDATE_COMPLETE`.

An absent `using-zimster/SKILL.md`, invalid build metadata, or a partial skill
copy is package corruption and remains an actionable error.

## Update and removal

Run the same synchronization command from the new Zimster version to update.
To remove the installation, delete only the Zimster-managed directories under
`.agents/skills/` and the Zimster metadata marker; preserve all unrelated
skills. Inspect the target's local Git exclude file if the repository should no
longer ignore Zimster-managed paths.
