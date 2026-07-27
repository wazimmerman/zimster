---
name: using-zimster
description: Select the smallest Zimster workflow that materially improves a software-development task.
---

# Using Zimster

Zimster preserves disciplined planning, RED-GREEN-REFACTOR, systematic
debugging, independent review, worktree isolation, and evidence-based
completion. It changes the orchestration model: one capable agent normally
owns coherent implementation from start to finish.

<SUBAGENT-STOP>
A subagent assigned a bounded task follows its assignment and the named skill.
It does not restart the full Zimster workflow or recruit more agents.
</SUBAGENT-STOP>

## The selection rule

Select the smallest workflow that addresses the actual risk. Do not load every skill, create a plan, or dispatch an agent merely because those mechanisms exist.

| Situation | Load |
|---|---|
| Exact, low-risk edit | `test-driven-development`, then `verification-before-completion` |
| Bug or unexplained failure | `systematic-debugging`, then TDD |
| Multi-file feature with meaningful choices | `designing-work`, then `writing-plans` |
| Approved plan or coherent implementation request | `owner-driven-development` |
| Two genuinely independent workstreams | `dispatching-parallel-agents` |
| Cross-component or high-risk change | `risk-adaptive-review` at the relevant seam |
| Branch completion | `finishing-a-development-branch` |

User instructions and repository instructions override Zimster defaults.

## Default execution profile

Use the persistent implementation owner unless the work divides cleanly.

- **Micro:** owner implements, focused tests, fresh final verification.
- **Standard:** owner implements vertical slices; one independent integration
  review when the feature crosses components.
- **High risk:** owner consults one targeted specialist early, reviews the
  risky seam, and obtains one final integration review.

A specialist is an optional bounded role, not a standing team. Specialization
comes from scope, evidence, tools, and review lens—not a decorative title.

## Cost and time controls

Unless the user requests otherwise:

- no more than two parallel implementation agents;
- subagents must not spawn subagents;
- one initial review and one resumed recheck per reviewed seam;
- one consolidated final correction wave;
- focused tests during iteration, affected suites at slice boundaries, and a
  full required gate once before completion;
- warn when the run has consumed about 60% of its stated budget and constrain
  optional work at about 80%.

Never reduce a required quality gate silently. Change strategy, consolidate
work, or report the unmet proof obligation.

## Durable state

For a long run, maintain a compact `.zimster/run.md` containing only:

1. mission and hard constraints;
2. architecture and current vertical slice;
3. completed evidence with commit or working-tree range;
4. open risks and review findings;
5. unavailable external, hardware, or human proof;
6. next action and remaining budget.

Do not paste whole diffs, test logs, or prior-agent transcripts into every
dispatch. Store artifacts in files and pass paths plus the minimum context.

## Harness adaptation

Read the matching reference only when needed:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`
- Cursor/Kimi/OpenCode/Pi: `references/other-harnesses.md`

When a harness lacks subagents, execute inline and state that independent
review assurance was unavailable. When a harness cannot verify an effective
model override, record the model as unverified rather than assuming it worked.
