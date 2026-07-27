---
name: finishing-a-development-branch
description: Finish a branch with fresh evidence, an honest completion state, and a safe integration or handoff choice.
---

# Finishing a Development Branch

## 1. Inspect state

Confirm:

- repository root, current branch, and worktree status;
- base branch and merge base;
- commits and full diff belonging to this work;
- no unrelated user changes are included;
- `.zimster/run.md` contains unresolved risks and unavailable proof.

A harness-managed detached checkout may require native “create branch” or
“hand off” controls. Do not claim a push or PR capability the environment does
not expose.

## 2. Verify

Load `verification-before-completion` and run every required final gate on the
final code. Include exact counts, warnings, ignored/skipped tests, and external
or manual checks.

Re-read the mission line by line. Automated success does not erase an unmet
hardware, service, migration, or acceptance obligation.

## 3. Final review

For medium/high-risk work, obtain one independent integration review over the
complete branch range. If it returns Critical or Important findings:

- use one consolidated owner correction wave;
- run covering evidence;
- use one resumed recheck;
- apply the circuit breaker to residual load-bearing findings.

Do not run another broad review merely to fish for a different verdict.

## 4. Report

Summarize:

- architecture and ownership changes;
- commits and diff scope;
- verification commands and counts;
- review verdict and any adjudications;
- unavailable proof and limitations;
- strongest supported completion state.

## 5. Choose branch outcome

When the environment permits, present the relevant safe choices:

1. keep the branch for further work;
2. push and create a pull request;
3. merge through the project's normal process;
4. hand off to the user's local or harness-managed checkout.

Never discard completed work as a routine menu item. Destructive cleanup
requires an explicit request and confirmation that no uncommitted work will be
lost.

After integration or explicit retention, clean only Zimster runtime scratch
owned by this run. Preserve durable design, plan, evidence, and source history
according to repository policy.
