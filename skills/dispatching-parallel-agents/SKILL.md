---
name: dispatching-parallel-agents
description: Delegate only genuinely independent workstreams with explicit ownership, budgets, and integration contracts.
---

# Dispatching Parallel Agents

Parallelism is useful when workstreams do not depend on the same evolving
state. It is not a default response to a long plan.

## Independence test

Parallel work is safe only when all are true:

- agents can complete without decisions produced by the other;
- file or component ownership does not overlap;
- each output has a clear integration contract;
- failures can be evaluated independently;
- concurrent repository operations will not corrupt branch or index state.

If two tasks share a lifecycle, state machine, public interface, migration, or
frequently edited files, keep one persistent owner.

## Default limit

Use a maximum of two parallel implementation agents. Read-only investigations
may be batched when the harness supports it, but each still needs a bounded
question and output contract.

Subagents must not spawn subagents. The root owner remains responsible for
integration, verification, and completion claims.

## Dispatch contract

First record whether delegation is selected and why it materially improves the
task. Also record why inline execution is less appropriate. An inexpensive or
available model is never evidence that delegation is useful. If delegation is
not selected, stop: no model proposal or dispatch is permitted.

Every selected delegation states:

- one outcome or question;
- owned files or read-only boundary;
- binding interfaces and constraints;
- dependency cone, tool restrictions, stop condition, and owner acceptance proof;
- turn or time budget;
- exact return format;
- where detailed artifacts should be written;
- prohibition on committing outside the assigned scope.

Only then create a plan-time advisory or dispatch-time authoritative proposal
using the harness-neutral `economy`, `balanced`, `expert`, or `inherit` class.
Resolve optional user mappings and current capability/catalog evidence at
dispatch time. Record requested and effective model/effort separately. A
strict-cost request that cannot prove enforcement returns optional work to the
owner or blocks required review; it never silently inherits.

## Integration

When agents return:

1. inspect their artifacts and version-control diff;
2. reject scope drift and conflicting assumptions;
3. integrate in dependency order;
4. run interface and affected tests after composition;
5. use one seam review if the combined work creates new risk.
6. record persistent-owner acceptance or rejection with its proof.

Do not trust an agent's “done” message as evidence. Do not create one fixer per
finding; the owner consolidates integration corrections. Rejected delegated
implementation returns to the owner and does not automatically recruit a
replacement.

## Stop conditions

Cancel or serialize the work when:

- agents begin editing the same files;
- one agent waits on another's unresolved design;
- repeated context questions erase the expected time savings;
- the integration contract changes;
- the agent count or turn budget is exceeded.
