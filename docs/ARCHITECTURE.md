# Architecture

## Design objective

Zimster separates durable development discipline from orchestration volume.
The methodology assumes a capable root model can retain architecture and
implement a coherent feature across multiple files. It spends additional
contexts only where isolation or independence provides measurable value.

## Layers

### 1. Harness-neutral core

The twelve skills under `skills/` describe actions rather than vendor tool
names. They define:

- workflow selection;
- compact mission design and planning;
- persistent-owner execution;
- TDD and systematic debugging;
- bounded parallel delegation;
- risk-adaptive review;
- branch isolation, review handling, and completion proof.

Core skills contain no hard-coded user paths and no operating-system-specific
shell assumptions.

### 2. Harness adapters

- **Codex:** `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.
  Codex gets native skill discovery and no SessionStart hook.
- **Claude Code:** `.claude-plugin/` plus `hooks/` injects only the compact
  `using-zimster` bootstrap.
- **Cursor:** `.cursor-plugin/` uses the same proven cross-platform hook wrapper.
- **Kimi:** `.kimi-plugin/` supplies native skill registration and tool mapping.
- **OpenCode:** `.opencode/plugins/zimster.js` registers the skills path and
  injects the bootstrap once into the first user message.
- **Pi:** `.pi/extensions/zimster.ts` registers skill resources and reinjects
  after session compaction.

Adapters do not redefine development policy. They map native tools to core
operations and state capability limitations honestly.

### 3. Maintenance runtime

Node 22 scripts provide deterministic local behavior without runtime
third-party dependencies:

- `validate.mjs` checks manifests, versions, frontmatter, portability, compact
  skill budgets, and notices;
- `doctor.mjs` reports installed adapter assets and host information;
- `package.mjs` writes byte-identical store-only ZIP archives;
- `check-upstream.mjs` monitors the pinned Superpowers release for maintenance
  review.

## Execution state

Long runs use `.zimster/run.md`, not a growing conversation summary. The state
contains only mission, constraints, architecture, completed evidence, open
risks, unavailable proof, next action, and budget position.

Detailed reports, diffs, and logs remain files. Dispatches pass paths and
bounded context so resident prompt cost does not grow with every prior step.

## Agent topology

```text
persistent implementation owner
├── optional bounded scout or consultant
├── at most two independent implementers when work is truly disjoint
├── one seam/integration reviewer
└── one diagnostician only after repeated unresolved failure
```

Subagents do not spawn subagents. The owner verifies and integrates every
result. A reviewer can apply several expert lenses in one pass.

## Review convergence

```text
initial review with complete batch
→ owner fixes Critical/Important findings together
→ same reviewer performs one scoped resumed recheck
→ circuit breaker for any load-bearing residual
```

The circuit breaker routes the residual to evidence-backed adjudication,
design revision, explicit deferral, or blocked status. It does not start an
unbounded sequence of fresh reviewers.

## Completion model

Zimster reports separate states for code, integration, live services, hardware,
and human acceptance. This prevents automated tests from being presented as
proof of an environment that was never exercised.
