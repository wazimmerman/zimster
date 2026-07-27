---
name: using-git-worktrees
description: Isolate consequential feature work safely while respecting existing branches, worktrees, and repository conventions.
---

# Using Git Worktrees

Use isolation for consequential implementation, parallel work, or experiments
that should not disturb the user's current checkout. Do not create a worktree
for a trivial exact edit when the repository is already on an appropriate
feature branch.

## Detect first

Run read-only Git commands to determine:

```text
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git status --short
git worktree list --porcelain
```

Interpretation:

- different git-dir and common-dir: already in a linked worktree;
- empty branch: detached HEAD; understand harness controls before branching;
- dirty tree: do not move or overwrite unrelated user changes;
- dedicated clean feature branch: usually sufficient isolation.

Never implement on the default branch without explicit user authorization.

## Choose location

Respect repository instructions and existing `.worktrees` or `worktrees`
conventions. Otherwise use a project-local ignored directory that works on the
host operating system. Avoid hard-coded user directories and shell-specific
path assumptions.

Confirm the chosen directory is ignored before creating a nested worktree.

## Create and verify

Use standard Git commands appropriate to whether the branch already exists.
After creation:

- confirm branch and root;
- install dependencies only as the project requires;
- run the smallest baseline test;
- record the worktree path and branch in `.zimster/run.md`.

## Parallel ownership

Each implementation agent receives its own branch/worktree or strictly
disjoint file ownership. Never let two agents mutate the same checkout and
index concurrently.

## Cleanup

Remove a worktree only after the branch outcome is decided and evidence is
preserved in commits. Never delete uncommitted work. A sandbox-managed or
harness-managed worktree may require the harness's own handoff controls; report
that rather than forcing Git operations.
