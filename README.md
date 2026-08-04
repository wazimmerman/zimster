# Zimster

Version 0.6.0 (public beta).

Zimster 0.6.0 is a public-beta, proof-first, owner-driven
software-development workflow for capable
coding agents. It retains the parts of disciplined agentic development that
earn their cost—RED-GREEN-REFACTOR, systematic debugging, isolated Git work,
independent review, and evidence before completion—while removing
plan-task-driven agent multiplication.

The default is one persistent implementation owner working in coherent vertical
slices. Delegation is optional and bounded. Zimster decides whether delegation
materially improves the task before considering model routing, so cheaper model
availability never increases delegation frequency.

## What Zimster retains from Superpowers

- RED-GREEN-REFACTOR with meaningful, behavior-specific RED evidence.
- Reproduction-first systematic debugging and regression proof.
- Explicit design/planning for consequential choices.
- Git branch/worktree isolation.
- Independent review and technical review adjudication.
- Fresh evidence before completion claims.
- Durable progress state for work that may span contexts.
- Cross-harness adapters and deterministic packaging patterns.

## What Zimster changes

- One persistent owner instead of a fresh implementer per plan task.
- Vertical slices instead of horizontal microtask layers.
- Deterministic Micro, Standard, and High-risk profiles.
- Review at risky architectural seams rather than every heading.
- One complete finding batch, one correction wave, and one resumed recheck.
- At most two parallel implementers by default; no sub-subagents.
- Explicit Git/commit disposition and complete untracked-file review.
- Auditable requested/effective model records.
- Harness-neutral economy, balanced, expert, and inherit proposals with
  optional user mappings and policy-bounded fallbacks.
- Bounded autonomous convergence for ordinary deterministic local failures.
- Local evidence receipts that detect stale and duplicate commands.
- Stable-ID requirement-to-evidence matrices and proof-bounded acceptance
  claims.
- Explicit `self_review` versus clean-context `independent_review`.
- Separate semantic verdict and reviewer-checkout integrity statuses.
- Honest states for code, integration, services, hardware, requirements, and
  human acceptance.

## Supported harnesses

| Harness | Status | Integration |
|---|---|---|
| Codex | Package/install verified; skill discovery blocked by host | Repo marketplace at `.agents/plugins/marketplace.json`, self-contained plugin at `plugins/zimster/` |
| Claude Code | Structurally validated | Native skills, bounded agents, compact SessionStart bootstrap |
| Cursor | Structurally validated | Agent Skills plus a project command; no invented plugin hook |
| Kimi Code | Structurally validated | Native plugin skills and one `sessionStart.skill` |
| OpenCode | Live config/skill discovery verified on 1.18.7 | Adapter registers skills and injects bootstrap once |
| Pi | Structurally validated | Package extension registers skills and injects bootstrap once |

The core skills are operating-system-neutral. Cursor, Kimi, OpenCode, and Pi
support is maintained as portable adapter support; Codex and Claude Code are the
primary compatibility targets.

## Codex packaging

The repository follows the current Codex repo/team marketplace shape:

```text
.agents/plugins/marketplace.json
plugins/zimster/
├── .codex-plugin/plugin.json
├── skills/
├── scripts/
├── config/
├── schemas/
└── ...
```

The Codex manifest omits Claude-only hook fields. `plugins/zimster/` is generated
from canonical source with `npm run sync:codex`; CI rejects drift with
`npm run sync:codex:check` and validates the result against a pinned local port
of the official Codex plugin-creator contract.

The Codex ZIP is a repository marketplace package containing both
`.agents/plugins/marketplace.json` and `plugins/zimster/`.

## Claude Code packaging

The Claude archive contains `.claude-plugin/`, `skills/`, `agents/`, `hooks/`,
and the operational helpers. For local development, point Claude Code's plugin
development option at the extracted archive or repository, then invoke the
`using-zimster` skill. Exact validation, isolated installation, update,
reviewer enforcement, and removal commands are in
[`docs/CLAUDE.md`](docs/CLAUDE.md).

## Main workflow

```text
select profile and Git disposition
→ mission/design only when choices matter
→ concise vertical-slice plan
→ persistent implementation owner
→ meaningful RED → minimal GREEN → REFACTOR
→ affected evidence
→ risk-triggered seam review
→ one correction wave and one resumed recheck
→ complete staged/unstaged/untracked review
→ fresh canonical final gates
→ requirement/evidence and semantic-review completion gate
→ explicit branch/commit handoff
```

## Risk profiles

- **Micro:** all risk dimensions Low, one local slice, no public contract or
  hard trigger, deterministic proof, no independent review required.
- **Standard:** one or more Medium dimensions or subsystem/multi-component work,
  with one review at the concentrated seam.
- **High risk:** any High dimension or hard trigger such as auth, destructive
  migration, concurrency ownership, public compatibility, native hardware/OS,
  unstable service, or live-only evidence.

Every run reports the selected profile and rationale.

## Operational controls

Zimster ships local, dependency-free Node tools. Resolve them from the installed
Zimster plugin root rather than assuming they exist in the target repository.
Normal operational state lives under the target worktree's Git administrative
path and does not appear in the product tree.

```text
node <zimster-root>/scripts/init-run.mjs --profile standard --reason "two slices"
node <zimster-root>/scripts/project-commands.mjs <target-repo>
node <zimster-root>/scripts/change-snapshot.mjs
node <zimster-root>/scripts/evidence.mjs run --kind test --scope focused -- <command>
node <zimster-root>/scripts/semantic-assurance.mjs matrix ...
node <zimster-root>/scripts/semantic-assurance.mjs complete ...
node <zimster-root>/scripts/dispatch-record.mjs record ...
```

- `init-run.mjs` creates durable state when deterministic triggers apply.
- `project-commands.mjs` inventories repository instructions, package scripts,
  task runners, and CI commands before an agent invents flags.
- `change-snapshot.mjs` includes committed-range, staged, unstaged, and untracked
  content without altering the index.
- `evidence.mjs` binds results to the working-tree fingerprint, command, cwd,
  environment, test discovery, counts, dependency cone, requirement IDs, and
  established/excluded claims.
- `semantic-assurance.mjs` validates complete stable-ID matrix coverage,
  candidate-tree evidence and claim scope, then gates candidate completion on
  the selected profile's semantic review.
- `dispatch-record.mjs` records abstract tier plus requested/effective model and
  effort, warning when a fast role inherits the parent model.

See `docs/OPERATIONS.md` for the full policy and command reference.
See `docs/INSTALL.md` for Codex, Claude Code, and skills-only installation,
update, rollback, and uninstall; `docs/CONFIGURATION.md` for routing and
convergence; `docs/KNOWN_LIMITATIONS.md` for beta constraints; and
`docs/MIGRATING-0.5.0.md` for compatibility guidance.
See `docs/CODEX.md` for complete package validation, isolated installation,
cachebuster updates, reinstall, removal, and live skill-discovery status.
Harness-specific installation, update, removal, diagnostics, and verification
status are documented in `docs/CLAUDE.md`, `docs/CURSOR.md`, `docs/KIMI.md`,
`docs/OPENCODE.md`, and `docs/PI.md`.
See `docs/DIAGNOSTICS.md` for quiet-fallback versus actionable-error semantics,
`docs/SKILLS_ONLY.md` for script-free synchronization, and
`docs/RELEASING.md` for the release checklist.

## Git lifecycle

| Context | Default behavior |
|---|---|
| Disposable/test repository explicitly intended for direct work | Default branch permitted; no automatic commit unless requested |
| Existing project on default branch | Stop or create a feature branch/worktree before implementation |
| Existing feature branch/worktree | Commit at verified vertical-slice boundaries |
| User says “do not commit” | Leave work uncommitted and report staged, unstaged, and untracked disposition |
| Delegated implementer | Commit only in an isolated branch/worktree with explicit commit permission |

The finishing workflow always reports branch, commits, staged files, unstaged
files, untracked files, reviewed scope, and whether work remains uncommitted.

## TDD falsifiability

For a multi-behavior new module, one `ERR_MODULE_NOT_FOUND` failure proves only
that the module is absent. Zimster requires incremental behavior REDs, a
purposefully incomplete stub, or targeted mutation checks for each load-bearing
invariant. This does not require one commit per test; it requires proof that the
tests can detect the defects they claim to protect.

## Verification semantics

Zimster prefers repository-declared commands from instructions, package
scripts, task runners, and CI. It distinguishes:

- command failure before test discovery;
- successful command with zero tests;
- baseline with zero tests;
- focused, affected, integration, and full project gates;
- external, hardware, and human observations.

Final gates are always fresh. Valid focused evidence may be reused only while
its fingerprint and dependency cone remain current.

Checkout integrity, evidence validity, self-review, and semantic approval are
different facts. Owner-inline inspection is `self_review`.
`REVIEW_CHECKOUT_UNCHANGED` proves no reviewer-visible mutation, not approval.
Eligible Micro work may complete owner-only; Standard and High-risk work
require approved clean-context `independent_review` for the exact candidate
head. Review-unavailable work remains explicitly partial. Only a complete
requirement-to-evidence matrix and profile-appropriate review can emit
`CANDIDATE_COMPLETE`.

## Local development

```text
npm install
npm run doctor
npm run check
```

Node 22 or newer is required for maintenance tools. The project has no runtime
dependencies.

Useful maintenance commands:

```text
npm run sync:codex
npm run assurance -- matrix ...
npm run assurance -- complete ...
npm run validate:codex
npm run codex:cachebuster -- /path/to/staging/plugins/zimster
npm run version:check
npm run version:bump -- <next-version> --note "Release summary"
npm run package
npm run checksums
```

A release tag is rejected unless it matches every manifest, lockfile, Claude
marketplace entry, Codex mirror, and current changelog heading.

## Repository layout

```text
skills/                 harness-neutral workflow skills
agents/                 bounded reviewer/scout/diagnostician roles
plugins/zimster/         generated self-contained Codex plugin
.agents/plugins/         Codex repo marketplace
.codex-plugin/           canonical Codex manifest source
.claude-plugin/          Claude manifest and development marketplace
.cursor/                 Cursor project command
.kimi-plugin/            Kimi manifest/tool mapping
.opencode/               OpenCode adapter
.pi/                     Pi extension
hooks/                   Claude compact bootstrap
scripts/                 operational, validation, version, packaging tools
config/                  abstract model routing policy
schemas/                 evidence, requirement, review, and completion schemas
vendor/                  pinned Codex contract snapshot and license
```

## Licensing and provenance

Zimster is MIT-licensed. Selected code and workflow language are adapted from
Superpowers 6.2.0 under MIT. The local Codex plugin-contract validator is a
compact JavaScript port pinned to official OpenAI Codex source under
Apache-2.0. See `THIRD_PARTY_NOTICES.md` and `docs/UPSTREAM.md`.

## Project status

Version 0.5.0 adds semantic assurance: explicit review types, stable-ID
requirements, evidence/claim scope, semantic review packages, risk-triggered
framework and shared-control-flow lenses, and deterministic candidate
completion. It retains execution-economy controls, cross-harness packaging,
and quiet fallback contracts.

Live installation in every harness and comparative
Zimster-versus-Superpowers economics remain evaluation work, not claimed
results. See `docs/EVALUATION.md`.
