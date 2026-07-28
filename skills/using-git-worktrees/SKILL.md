---
name: using-git-worktrees
description: Apply deterministic branch and worktree isolation policy without disturbing unrelated user changes.
---

# Using Git Worktrees

Use isolation for consequential implementation, parallel work, or experiments.
A clean dedicated feature branch can be sufficient; a worktree is not ritual.

## Detect first

Run read-only commands:

```text
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git status --short
git worktree list --porcelain
```

Interpretation:

- different git-dir/common-dir: already linked worktree;
- empty branch: detached HEAD; understand harness controls;
- dirty tree: preserve unrelated changes;
- clean dedicated feature branch: usually isolated enough.

## Deterministic policy

| Context | Behavior |
|---|---|
| Disposable/test repo explicitly intended for direct work | Default branch allowed; do not commit unless policy/request says so. |
| Existing project on default branch | Stop before implementation or create a feature branch/worktree unless explicitly authorized. |
| Existing clean feature branch/worktree | Continue there and commit at verified slice boundaries. |
| Dirty checkout with unrelated changes | Create a separate worktree/branch; do not move or overwrite changes. |
| Parallel implementers | Give each an isolated branch/worktree or strictly disjoint ownership; never share one index concurrently. |
| User says do not commit | Isolation may still be used, but leave changes uncommitted and report them. |

## Location and creation

Respect repository instructions and existing `.worktrees`/`worktrees`
conventions. Otherwise use a project-local ignored directory that works on the
host OS. Avoid hard-coded home paths and shell assumptions. Confirm the
location is ignored before creation.

After creation, confirm branch/root, install only required dependencies, run
the smallest baseline, and record path/branch/commit policy in the Git-local
Zimster run record
when durable state is required.

## Cleanup

Remove a worktree only after branch outcome is decided and evidence is
preserved. Never delete uncommitted work. Harness-managed worktrees may require
native handoff controls; report this rather than forcing Git operations.
