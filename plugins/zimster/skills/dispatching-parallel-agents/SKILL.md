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

Every dispatch states:

- one outcome or question;
- owned files or read-only boundary;
- binding interfaces and constraints;
- model tier and reasoning effort when the harness supports them;
- turn or time budget;
- exact return format;
- where detailed artifacts should be written;
- prohibition on committing outside the assigned scope.

Use the least expensive model likely to finish in few turns. Cheap models that
require repeated retries or miss judgment-heavy defects are not economical.
Record the requested and effective model separately when possible.

## Integration

When agents return:

1. inspect their artifacts and version-control diff;
2. reject scope drift and conflicting assumptions;
3. integrate in dependency order;
4. run interface and affected tests after composition;
5. use one seam review if the combined work creates new risk.

Do not trust an agent's “done” message as evidence. Do not create one fixer per
finding; the owner consolidates integration corrections.

## Stop conditions

Cancel or serialize the work when:

- agents begin editing the same files;
- one agent waits on another's unresolved design;
- repeated context questions erase the expected time savings;
- the integration contract changes;
- the agent count or turn budget is exceeded.
