---
name: finishing-a-development-branch
description: Finish or hand off work with complete change inspection, fresh evidence, explicit commit disposition, and a safe branch outcome.
---

# Finishing a Development Branch

This workflow always runs at the end of owner-driven development, including
no-commit and disposable-repository work.

## 1. Inspect complete repository state

Run and record:

```text
git rev-parse --show-toplevel
git branch --show-current
git status --short
git diff
git diff --cached
git log --oneline <merge-base>..HEAD
```

Identify base branch/merge base, linked-worktree state, commits belonging to the
work, unrelated user changes, staged files, unstaged files, and untracked
files. Generate a `change-snapshot` or read every untracked file; `git diff`
alone cannot establish readiness for brand-new files.

For every dispatch v2 record, require a consumed authoritative proposal,
requested/effective routing accounting, and persistent-owner acceptance. A
pending or rejected delegated implementation cannot satisfy completion.

A harness-managed detached checkout may require native branch/handoff controls.
Report limitations instead of pretending push/PR capability.

## 2. Enforce Git disposition

- Existing project on default branch without explicit authorization should not
  have reached implementation; stop and surface the policy breach.
- On an isolated feature branch/worktree, verified vertical slices should be
  committed unless the user said not to commit.
- In a disposable/test repo explicitly intended for direct work, default branch
  and uncommitted output are permitted when that was the chosen policy.
- When the user says “do not commit,” do not stage or commit; report the exact
  verified but uncommitted files.
- A delegated implementer commit is accepted only from its dedicated
  branch/worktree and explicit commit grant.

Never leave verified but uncommitted work implicit. State whether it is staged,
unstaged, or untracked and what the user must preserve.

## 3. Verify final code

Load `verification-before-completion`. Run canonical required gates fresh on the
final tree and record exact test discovery/counts, warnings, ignored/skipped
tests, and external/manual evidence. Re-read the mission line by line.

## 4. Final review

For Standard/High-risk work, obtain one independent integration review over the
complete committed range identified by immutable base and head SHAs, or a
no-commit change snapshot. A shell-capable reviewer must use the before/after
review-integrity guard. Reserve this review until the candidate stops changing;
correction rechecks do not satisfy or consume it. If Critical/Important findings exist:

- owner performs one consolidated correction wave;
- run covering evidence;
- the configured finalization budget supplies another exact-head review;
- apply the circuit breaker to residual load-bearing findings.

Do not fish for a different verdict with repeated broad reviews.

## 5. Final report

Always report in one place:

- repository root, current branch, base/merge base;
- commits created and commit subjects;
- staged files;
- unstaged files;
- untracked files;
- whether all implementation content was reviewed;
- architecture/diff scope;
- verification commands, discovery classification, and exact counts;
- review verdict/adjudications;
- unavailable proof/limitations;
- strongest completion state;
- whether work remains uncommitted.

A `CODE_READY` claim with untracked implementation files is permitted only when
the no-commit policy was explicit and every file was reviewed; it must say
`CODE_READY — verified but uncommitted`, not imply branch readiness.

## 6. Choose outcome

Offer only applicable safe outcomes:

1. keep the branch/worktree;
2. push and create a pull request;
3. merge through the project's normal process;
4. hand off to the user's local or harness-managed checkout;
5. preserve explicitly requested uncommitted work.

Never offer routine discard. Destructive cleanup requires explicit request and
confirmation that no uncommitted work will be lost. Clean only Zimster runtime
scratch owned by the run after outcome is decided.
