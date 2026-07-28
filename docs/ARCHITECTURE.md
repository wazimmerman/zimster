# Architecture

## Objective

Zimster separates durable development discipline from orchestration volume. A
capable root model retains architecture and implements a coherent feature;
additional contexts are spent only where isolation or independent judgment
provides value.

## Layers

### 1. Harness-neutral skills

The twelve skills under `skills/` define workflow selection, design/planning,
persistent-owner execution, TDD, systematic debugging, bounded parallelism,
risk-adaptive review, Git isolation, review handling, and completion proof.
Core skills avoid hard-coded user paths and OS-specific shell assumptions.

### 2. Harness adapters

- **Codex:** the repository marketplace at `.agents/plugins/marketplace.json`
  points to `plugins/zimster/`. That directory is a self-contained generated
  plugin with accepted manifest fields, skills, operational scripts, config,
  schemas, templates, assets, and notices. Claude hooks are not inside it.
- **Claude Code:** `.claude-plugin/`, `skills/`, `agents/`, and `hooks/` expose
  native skills, bounded roles, and a compact `using-zimster` bootstrap.
- **Cursor/Kimi/OpenCode/Pi:** thin adapters map tools and skill discovery
  without redefining core policy.

### 3. Operational control plane

Dependency-free Node 22 tools turn important policy into inspectable state:

- `init-run.mjs` creates durable execution state;
- `project-commands.mjs` inventories canonical project commands;
- `change-snapshot.mjs` represents committed, staged, unstaged, and untracked
  changes without touching the index;
- `evidence.mjs` records local proof receipts and validity fingerprints;
- `dispatch-record.mjs` records requested/effective model routing;
- `sync-codex-plugin.mjs` generates the Codex plugin mirror;
- `validate-codex.mjs` checks the pinned official contract snapshot;
- `validate-claude-plugin.mjs` checks the current documented Claude manifest,
  hook, and plugin-agent contract when the host CLI is unavailable;
- `check-version.mjs` and `bump-version.mjs` synchronize release metadata;
- `package.mjs` creates deterministic archives only from a current mirror and
  synchronized version set.

No run receipt or model record is uploaded. Normal runtime artifacts live
under the worktree-safe Git administrative path returned by
`git rev-parse --git-path zimster`, outside product history.

## Codex source and package flow

```text
canonical root files
→ npm run sync:codex
→ plugins/zimster/
→ pinned Codex contract validation
→ .agents/plugins/marketplace.json local reference
→ deterministic Codex marketplace ZIP
```

`sync:codex:check` compares every generated file digest and rejects missing,
changed, or extra files. Packaging refuses a stale mirror.

## Execution state

Create the Git-local `zimster/run.md` when there is more than one slice, any subagent or
independent review, pending external/hardware proof, more than one commit
boundary, compaction risk, or a resumed session. It stores mission,
profile/rationale, Git disposition, architecture, current slice, evidence IDs,
dispatch IDs, open findings, unavailable proof, budget, and next action.

Detailed logs, diffs, and transcripts remain separate artifacts.
Projects may opt into a project-defined audit documentation path; normal
operation never turns approval or run bookkeeping into a standalone commit.

## Git state and review representation

A review cannot rely on `git diff` alone. The change snapshot includes:

```text
base..HEAD committed range (when supplied)
git diff --cached
git diff
git status --short
full text or hash/metadata for every untracked file
```

This supports both committed feature branches and explicit no-commit work. The
snapshot does not mutate the index.

## Evidence model

An evidence receipt includes:

- command, cwd, kind, and scope;
- Git head/tree and complete working-tree fingerprint;
- environment fingerprint;
- start/end time and exit code;
- test-discovery classification and exact counts;
- dependency cone, inputs, source, and notes;
- whether it was a final gate.

Focused evidence may be reused only on the same fingerprint. Final gates are
always fresh. Duplicate evidence is surfaced instead of silently rerun.

## Model-routing model

Roles map to abstract tiers (`fast`, `standard`, `expert`) rather than vendor
model names. Each dispatch records requested model/effort and the effective
values returned by the harness. `unverified` is explicit when the harness does
not report them. A fast role inheriting the parent model produces a warning.

## Agent topology and safety

```text
persistent implementation owner
├── optional pure read-only scout
├── at most two isolated implementers for disjoint work
├── pure read-only seam/integration reviewer
├── tree-guarded test reviewer for one named command
└── isolated diagnostician after repeated owner failure
```

Subagents do not spawn subagents. Pure reviewers have no Bash. Test-capable
roles record before/after fingerprints and report any mutation rather than
cleaning it.

## Review convergence

```text
complete initial finding batch
→ owner fixes Critical/Important findings together
→ same reviewer performs one scoped resumed recheck
→ circuit breaker for load-bearing residuals
```

Residuals route to technical adjudication, design/requirement blocker,
explicit deferral, diagnosis, or partial evidence—not an unbounded reviewer
lottery.

## Completion model

Zimster separates code, integration, service, hardware, human acceptance,
environment blockers, requirement blockers, and partial verification. The
final report also states branch, commits, staged/unstaged/untracked files, and
whether implementation remains uncommitted.
