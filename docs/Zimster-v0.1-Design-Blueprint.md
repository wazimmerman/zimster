# Zimster v0.1 — Design Blueprint

## Executive thesis

Zimster should not be a shortened copy of Superpowers. It should preserve the controls that demonstrably improve outcomes—test-first development, explicit plans, isolated work, evidence before completion, and independent review—while replacing the orchestration model that turns every plan boundary into a new agent, every review finding into another model cycle, and every tightly coupled subsystem into a sequence of artificially isolated tasks.

The central design choice is:

> **One persistent implementation owner builds coherent vertical slices. Specialists are recruited only for bounded, high-risk questions. Reviews happen at architectural seams, not after every plan heading.**

This changes the economics without simply lowering the quality bar.

Zimster’s intended positioning:

> **Risk-adaptive, evidence-driven software engineering for frontier coding agents: one persistent owner, bounded specialists, vertical slices, proof-first tests, and explicit execution budgets.**

---

## 1. What the Atmosvox run demonstrates

### 1.1 It was not an accidental misuse of Superpowers

The run followed the intended Subagent-Driven Development pattern:

1. Write a comprehensive plan.
2. Split it into eleven independently reviewable tasks.
3. Dispatch a fresh implementer for each task.
4. Dispatch an independent reviewer after each task.
5. Return findings to the implementer.
6. Dispatch a fresh re-reviewer after each fix round.
7. Perform a whole-branch review.
8. Dispatch integration fixes.
9. Re-review those fixes.
10. Finish the branch only after approval.

The result was approximately:

| Role | Agent identities |
|---|---:|
| Task implementers | 11 |
| Task reviewers and re-reviewers | 28 |
| Final-stage reviewer/fixer/re-reviewers | 4 |
| **Total subagents** | **43** |

About 31 of the 43 identities were review-only roles. That is roughly 72 percent of all spawned identities, excluding the primary orchestrator and the planning session.

This matters because it means the cost was not primarily caused by an obviously incorrect prompt or a rogue agent. The orchestration system multiplied a legitimate, high-detail plan into an extremely large number of model sessions.

### 1.2 The work was genuinely difficult

The feature was not a trivial CRUD change. It involved:

- Native GStreamer decoding and an application-owned PCM boundary.
- Direct ALSA device enumeration, capability probing, opening, negotiation, writing, and teardown.
- Concurrency and lifecycle coordination across decoder, bounded PCM queue, writer thread, controller, UI commands, and event reducers.
- Exact rate, channel, format, and processing invariants for a Bit-perfect verdict.
- Hotplug, busy-device, pause, seek, stop, EOF, queue advancement, mode transitions, and stale-event rejection.
- Runtime Signal Path authority spanning backend state and frontend rendering.

The reviews found real defects. Task 5 alone required multiple rounds to resolve synchronization, cancellation, teardown, epoch, and seek-correlation problems. The final branch review found additional cross-task lifecycle and state-authority defects after all eleven task reviews had passed.

Therefore, the right conclusion is not “review was useless” or “TDD was unnecessary.” The correct conclusion is that the controls were applied at the wrong granularity and through too many cold contexts.

### 1.3 The process optimized local task correctness before integration correctness

The plan decomposed the system into contracts, discovery, probing, writer, direct player, router, Exclusive semantics, Bit-perfect semantics, UI, hardware tests, and documentation. On paper, each had an independently testable output. In the actual product, however, the core of the feature was one tightly coupled state machine:

- The player supplies PCM to the writer.
- The writer’s lifecycle determines whether the DAC is still open.
- The router changes the active backend and generation authority.
- Runtime facts determine the Signal Path verdict.
- Those facts flow through snapshots and asynchronous frontend updates.
- Pause, seek, stop, hotplug, retry, and mode changes cross nearly every boundary.

Fresh ownership per plan task created local understanding but repeatedly discarded the integrated mental model. Task-scoped reviewers were also instructed not to crawl the broader codebase except for a named risk. This made them efficient at reviewing a diff, but weak at discovering defects created by interactions among already-approved tasks.

The nine defects found by the whole-branch review were not surprising outliers. They were the predictable consequence of deferring integration reasoning until the most expensive point in the run.

### 1.4 Seven hours did not produce full product verification

The branch ended with strong automated evidence:

- 58 frontend tests.
- 206 Rust tests.
- Startup checks, lint, production build, formatting, Cargo check, strict Clippy, and diff checks passing.
- Five hardware-gated tests present but ignored.

No physical DAC test was executed. Yet the plan’s completion criteria included an actual tested DAC, requested and negotiated hardware parameters, exact formats and rates, and proof supporting Bit-perfect verdicts.

This exposes an important distinction that Zimster should make explicit:

- **Code-ready:** implementation and deterministic automated tests pass.
- **Integration-verified:** the complete software path passes end-to-end checks in the available environment.
- **Hardware-verified:** required physical-device evidence has been captured.
- **Human-acceptance pending:** subjective or audible behavior remains unverified.

A process should never allow “approved” to blur these states together.

---

## 2. Root causes of the inefficiency

### 2.1 The number of tasks directly controls the number of agents

Superpowers’ plan writer intentionally produces detailed tasks and microsteps. Its SDD executor then assigns at least one implementer and one reviewer to every task. This creates a simple multiplication effect:

```text
minimum agent starts ≈ tasks × 2 + final review
actual agent starts  ≈ minimum + re-review rounds + final fix/re-review rounds
```

For the Atmosvox run:

```text
11 implementers
+ 11 initial task reviewers
+ 17 task re-reviewers
+ 4 final-stage agents
= 43 subagents
```

A more detailed plan can therefore increase cost in two independent ways:

1. More text must be read and carried into task briefs.
2. More task boundaries automatically create more agent and review cycles.

The initial attached prompt was approximately 1,576 words. The generated implementation plan was approximately 4,101 words—about 2.6 times as long—and it created eleven orchestration gates.

### 2.2 Valuable detail and procedural detail are treated the same

Some detail is essential:

- Exact invariants.
- Interfaces shared across components.
- Unsupported behaviors.
- Failure semantics.
- Proof obligations.
- Acceptance evidence.

Other detail is largely procedural repetition:

- “Write failing test.”
- “Run test and observe failure.”
- “Implement minimal code.”
- “Run test and observe success.”
- “Commit.”
- Repeated file lists and command blocks for every task.

For frontier coding models, the first category improves fidelity. The second category often consumes plan space without adding task-specific knowledge. Worse, when every procedural block becomes part of a separately reviewed task, it increases orchestration cost.

Zimster should retain **semantic density** and remove **procedural duplication**.

### 2.3 Cold-context independence is overused

Fresh contexts are useful when:

- A reviewer must be independent.
- Exploration would pollute the main context.
- A task is self-contained.
- Several workstreams can proceed without shared mutable state.

Fresh contexts are harmful when:

- Several phases mutate the same state machine.
- Each phase depends on architectural decisions made moments earlier.
- An implementer must repeatedly reconstruct why prior code was shaped a certain way.
- Integration correctness matters more than local task isolation.

Atmosvox belonged largely in the second category. The writer, appsink player, router, runtime facts, verdict evaluator, and snapshot revision authority should have had one persistent implementation owner.

### 2.4 Review is mandatory by count rather than triggered by risk

Superpowers requires review after every SDD task and again before merge. This treats these changes similarly:

- Adding serialized enum defaults.
- Implementing a concurrent ALSA writer.
- Adding five deterministic fixtures.
- Updating documentation.

They do not have the same risk profile and should not incur the same independent-review ceremony.

Zimster should trigger review based on:

- Concurrency and lifecycle complexity.
- Security, authorization, privacy, or financial consequences.
- Data migration or destructive behavior.
- Public API or persistent-schema changes.
- Hardware/native-system integration.
- Novel algorithms or unclear library semantics.
- Large blast radius.
- Poor observability or difficult rollback.

Low-risk changes can be owner-verified. Medium-risk changes receive a seam review. High-risk changes may receive an early specialist pre-mortem and a later seam review.

### 2.5 Review findings are serialized into too many model cycles

The current pattern is generally:

```text
implement → review → fix → re-review → fix → re-review
```

Even when the original implementer is resumed, each re-review is another agent turn sequence. The cost grows sharply when a reviewer surfaces findings incrementally.

Zimster should instead use:

```text
implement slice → batch review findings → owner fixes batch → same reviewer rechecks once
```

After one failed recheck, the root owner adjudicates whether the issue is:

- A real unresolved defect.
- A misunderstanding.
- A broader design problem.
- Blocked by unavailable evidence.

A diagnostician may be recruited at that point, but the system should not automatically begin another generic review cycle.

### 2.6 Tests are rerun according to ceremony rather than evidence reuse

Superpowers appropriately encourages focused tests during implementation and full verification before commits. Across eleven tasks, fix rounds, final fixes, and final acceptance, however, this can still produce substantial duplicate work.

Zimster should maintain an evidence ledger keyed by:

```text
(commit SHA, command, environment fingerprint, relevant inputs)
```

The verifier can then distinguish:

- Fresh evidence.
- Evidence invalidated by changed files.
- Evidence still valid because the tested dependency cone did not change.
- Evidence requiring a complete rerun.

The default verification ladder should be:

1. RED test for the behavior being added or defect being reproduced.
2. Focused GREEN test while iterating.
3. Affected test group before completing a vertical slice.
4. Subsystem suite at an integration milestone.
5. Full suite once before final review.
6. One additional full suite only if the final fix touched shared or cross-cutting code.

### 2.7 Model routing is advisory rather than reliably enforced

The run record does not contain effective model and reasoning effort for each subagent, so it cannot prove that every agent inherited the same model. The concern is nevertheless valid.

Both Codex and Claude Code can inherit the parent model when an explicit override is absent. Superpowers tells the orchestrator to choose and state an appropriate model, but this is still a prompt-level policy. A controller can omit the field, choose poorly, or operate in a harness configuration that hides overrides.

Zimster should treat model routing as an auditable system function:

- Detect whether the harness exposes model and effort overrides.
- Select a role tier through a deterministic router.
- Request the model and effort explicitly.
- Record the requested values.
- Record the effective values when the harness reports them.
- Mark effective values as unverified when the harness does not report them.
- Avoid spawning a mechanical subagent when it would merely inherit an expensive owner model and provide no isolation benefit.

### 2.8 Nested agents must be treated as a harness capability, not an assumption

The provided Atmosvox record does not prove that subagents spawned sub-subagents. Current Claude Code documentation states that subagents cannot spawn other subagents; delegation must be chained from the main conversation. Codex, by contrast, implements a configurable thread-spawn depth limit, so nested delegation can be technically possible depending on the active multi-agent configuration.

Zimster should make the root orchestrator the only process allowed to recruit agents regardless of harness:

- Set maximum nesting depth to one where the harness supports it.
- Remove the agent-spawning tool from specialist definitions or allowlists.
- Reject or flag an unexpected nested spawn in run telemetry.
- Require the root owner to name the reason and budget for each specialist.

---

## 3. What Zimster should preserve

Zimster should not throw away the strongest parts of Superpowers.

### 3.1 Preserve proof-first development

The RED–GREEN–REFACTOR loop is valuable because it establishes that a test can detect the missing behavior before the implementation exists.

Zimster should retain this invariant for behavior changes:

```text
No behavioral production change without either:
1. a failing test or reproducible check first, or
2. a recorded, justified exception for an unautomatable boundary.
```

Unlike a rigid “every new function must have a unit test” rule, Zimster should focus on externally meaningful behavior and risk. Tests should protect contracts, invariants, failure modes, and regressions—not implementation trivia.

### 3.2 Preserve systematic debugging

For a defect:

1. Reproduce it.
2. Localize the failure.
3. Form a falsifiable hypothesis.
4. Change one cause.
5. Verify the original reproduction.
6. Run affected regressions.

The process can be expressed compactly without losing its mechanism.

### 3.3 Preserve explicit planning

Planning remains useful, but Zimster plans should be compact mission contracts rather than executable novels.

A good plan should specify:

- Goal and exclusions.
- Existing architecture that must be preserved.
- Hard invariants.
- Unknowns that could invalidate the approach.
- Architectural seams and risk areas.
- Vertical slices.
- Proof obligations.
- Required external or human evidence.
- Finish conditions.

### 3.4 Preserve independent judgment where it matters

A fresh reviewer remains valuable for:

- Concurrency and lifecycle behavior.
- Security-sensitive code.
- Data migrations.
- Public API compatibility.
- Hardware/native-system interfaces.
- Final integration.

The change is not “no reviewers.” It is “fewer, better-placed reviewers with the correct domain and scope.”

### 3.5 Preserve evidence before completion

Zimster should require a final evidence matrix that states exactly what passed, what was not run, and what remains unverified. It should never substitute a process verdict for missing real-world evidence.

---

## 4. Zimster’s execution model

### 4.1 Roles

#### Root owner

The main agent owns:

- Mission interpretation.
- Plan and risk classification.
- Architectural continuity.
- Implementation unless delegation has a clear benefit.
- Agent recruitment and budgets.
- Evidence ledger.
- Final status.

The root owner does not become a passive dispatcher. Frontier models are capable enough to implement substantial coherent slices while retaining the overall architecture.

#### Scout

A read-only, low-cost specialist used for bounded exploration:

- Locate relevant interfaces.
- Summarize library behavior from primary sources.
- Map call sites.
- Inspect logs or historical changes.

The scout returns a compact artifact and cannot modify code or spawn agents.

#### Test/reproduction specialist

Used when the main challenge is constructing a reliable reproduction, fixture, or invariant test. It may be standard-tier rather than cheapest-tier because test judgment is not purely mechanical.

#### Domain reviewer

A high-judgment specialist selected for the actual risk:

- Concurrency/lifecycle reviewer.
- Security reviewer.
- Database/migration reviewer.
- Native audio/hardware reviewer.
- Frontend state-authority reviewer.

It reviews a vertical slice and the relevant seams, not just a syntactic task diff.

#### Integration reviewer

A fresh, high-capability agent that reviews the finished change against the mission contract, cross-slice invariants, deferred concerns, and evidence matrix.

#### Diagnostician

Optional and exceptional. Recruited after the owner has failed twice on the same observed failure or after a seam reviewer identifies a structural defect that the owner cannot localize.

### 4.2 Default workflow

#### Stage 0 — Capability and budget negotiation

At the start of a run, Zimster detects or records:

- Harness and version.
- Parent model and reasoning effort.
- Model override support.
- Agent resume/fork support.
- Maximum nesting depth.
- Token/turn telemetry availability.
- Working-tree isolation.
- Test commands and affected-test capabilities.
- External dependencies and hardware availability.

It then establishes a run budget.

#### Stage 1 — Mission contract

Create a concise artifact such as `.zimster/mission.md`:

```markdown
# Mission

Goal:
Out of scope:
Existing behavior to preserve:
Hard invariants:
Unknowns / proof gates:
Vertical slices:
High-risk seams:
Verification ladder:
Required external evidence:
Completion states:
```

The plan should normally be readable in a few minutes. Exact signatures and values belong in it when they are hard constraints; generic TDD boilerplate does not.

#### Stage 2 — Baseline and proof gate

Run the baseline once and attack the highest-risk unknown before building the entire architecture.

Examples:

- Can the target ALSA device be opened directly?
- Can exact sample-rate negotiation be observed?
- Does the selected framework expose the needed lifecycle hook?
- Can the database migration be reversed safely?
- Does the external API permit the required operation?

When the proof gate requires unavailable hardware or credentials, record that immediately. Do not spend hours creating an illusion of full verification.

#### Stage 3 — Persistent-owner vertical slices

The owner implements coherent end-to-end behavior, not horizontal layers that remain disconnected until late.

For each slice:

1. Define observable acceptance behavior.
2. Create the failing test or reproduction.
3. Implement the smallest end-to-end path.
4. Refactor while green.
5. Run affected tests.
6. Update evidence and risk state.
7. Request a specialist review only if a review trigger fires.

#### Stage 4 — Seam review

A seam review is triggered by risk, not task count. The reviewer receives:

- Mission contract.
- Relevant invariants.
- Slice diff.
- Relevant call-site/context package.
- Test evidence.
- Named risks.

It is explicitly allowed to inspect the bounded dependency cone needed to judge those risks.

Findings are returned in one batch. The owner fixes them in one batch. The same reviewer performs one scoped recheck.

#### Stage 5 — Integration and verification

After all slices are connected:

- Run the subsystem and full-suite gates according to the verification ladder.
- Execute available external/hardware checks.
- Perform one fresh integration review.
- Apply one consolidated fix wave if necessary.
- Re-run only invalidated evidence plus the final required gate.

#### Stage 6 — Honest finish state

Zimster reports one or more explicit states:

- `CODE_READY`
- `INTEGRATION_VERIFIED`
- `HARDWARE_VERIFIED`
- `HUMAN_ACCEPTANCE_VERIFIED`
- `BLOCKED_BY_ENVIRONMENT`
- `BLOCKED_BY_REQUIREMENT`
- `PARTIALLY_VERIFIED`

It also reports every unmet proof obligation.

---

## 5. Risk-adaptive review policy

### 5.1 Risk dimensions

Score each slice from 0 to 2 on:

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Blast radius | Local | Subsystem | Cross-system/public |
| Concurrency/lifecycle | None | Simple async | Races, cancellation, ownership |
| Security/data loss | None | Recoverable | Auth, destructive, financial, irreversible |
| External/native boundary | None | Stable API | Hardware, OS, unstable provider |
| Novelty | Established pattern | Some adaptation | New architecture/unknown semantics |
| Testability | Deterministic | Requires fixtures | Hard to observe/reproduce |

Suggested classification:

- **0–3: Low risk** — owner verification; no mandatory subagent.
- **4–7: Medium risk** — one seam review.
- **8–12: High risk** — early specialist consultation, seam review, and final integration review.

Hard triggers can force high risk regardless of score:

- Authentication or authorization.
- Payments or billing.
- Destructive operations.
- Data migration.
- Native concurrency.
- Cryptography.
- Hardware/device control.
- Public protocol or compatibility contract.

### 5.2 Review budget

Balanced defaults:

```text
Maximum specialist identities: 5
Maximum nested depth: 1
Maximum rechecks per review gate: 1
Maximum generic review waves: 0
Maximum final fix waves: 1
```

A high-assurance mode may raise the specialist cap, but it should not restore review-after-every-heading by default.

---

## 6. Model and effort routing

Zimster should route by role and risk, not by a vague instruction to “use a cheaper model when possible.”

### 6.1 Abstract tiers

| Tier | Typical work | Default effort |
|---|---|---|
| Fast | Search, file mapping, log summarization, docs | Low/medium |
| Standard | Bounded implementation, test design, debugging | Medium/high |
| Expert | Architecture, concurrency, security, final integration | High/xhigh |

Rules:

- Never use the cheapest tier as the sole reviewer for a meaningful correctness gate.
- Do not spawn a Fast agent when it will inherit the same expensive model and the task is shorter than the delegation overhead.
- Use the persistent owner for tightly coupled implementation.
- Use fresh Expert context for final independent review.
- Prefer a resumed specialist for rechecking its own findings.

### 6.2 Harness-specific implementation

#### Claude Code

Define plugin agents with:

- Explicit `model`.
- Explicit `effort`.
- `maxTurns`.
- Minimal tool allowlists.
- No Agent tool for specialists.
- Isolation only when needed.

Set or recommend nesting depth one. Use a fresh named reviewer for independent final judgment; use a fork only when shared context and prompt-cache reuse are more valuable than independence.

#### Codex

Use `spawn_agent` model and reasoning overrides when exposed. Probe capabilities at run start. Record requested and effective metadata. When overrides are unavailable, route selectively rather than blindly spawning inherited-model agents.

### 6.3 Model-routing record

Every dispatch should produce a compact ledger entry:

```json
{
  "role": "concurrency_reviewer",
  "reason": "ALSA writer/player lifecycle seam",
  "requested_model_tier": "expert",
  "requested_effort": "high",
  "effective_model": "reported model or unknown",
  "effective_effort": "reported effort or unknown",
  "max_turns": 12,
  "nested_spawning": false
}
```

---

## 7. Token, turn, and test budgets

### 7.1 Why turns matter

The economic unit is not merely the price of one token. Every additional agent turn rereads resident context, incurs model latency, and may trigger more tools and tests. A cheaper model that takes two or three times as many turns can be slower and no cheaper overall.

Zimster should therefore budget:

- Agent starts.
- Assistant turns.
- Tool calls.
- Context bytes/tokens.
- Test commands.
- Duplicate commands.
- Full-suite executions.
- Review and fix waves.

### 7.2 Suggested balanced-mode defaults

```toml
mode = "balanced"
max_specialist_agents = 5
max_nested_depth = 1
max_review_rechecks = 1
max_final_fix_waves = 1
max_full_suite_runs = 2
max_duplicate_command_runs = 2
planning_budget_fraction = 0.10
review_budget_fraction = 0.25
warn_at_budget_fraction = 0.60
constrain_at_budget_fraction = 0.80
```

At 60 percent of budget, Zimster reports the main cost drivers. At 80 percent, it stops spawning optional specialists, consolidates remaining work, and prioritizes required evidence. It does not silently lower correctness gates; it changes strategy or reports an unmet obligation.

### 7.3 Evidence cache

Store command evidence under `.zimster/evidence/` with:

- Command.
- Working directory.
- Commit SHA.
- Environment fingerprint.
- Start/end time.
- Exit code.
- Relevant output digest.
- Files/dependency cone covered.
- Invalidated-by changes.

This allows reviewers and the final verifier to consume evidence without rerunning every command.

---

## 8. Applying Zimster to the Atmosvox feature

The same feature could be organized into four vertical slices rather than eleven independently owned tasks.

### Slice A — Proof gate and architecture invariants

Goals:

- Inspect and preserve existing Goal 003/004 boundaries.
- Run baseline verification.
- Prove direct `hw:` open and exact negotiated parameters against the explicit DAC when available.
- Establish the integrated state-machine invariants before implementation.

Critical invariants to identify early:

- One global generation/revision authority.
- Device lease and `device_open` facts share the same lifecycle.
- Pause does not falsely report a pristine open path after releasing the device.
- No direct-mode failure starts Normal output.
- Active-device probing cannot classify the active device as busy.
- Command cancellation is bounded and authoritative.
- Stale events and snapshots cannot overwrite newer state.
- Every direct transport error becomes a typed failure with explicit alternatives.

Specialist use:

- One native-audio/concurrency specialist performs a short pre-mortem.

### Slice B — First complete direct path

Implement one end-to-end path:

```text
16-bit / 44.1 kHz FLAC
→ GStreamer decode
→ appsink
→ bounded PCM queue
→ ALSA writer
→ explicit hw: device
```

Include enough routing and state publication to prove:

- Load/play/pause/resume/stop.
- Exact negotiated parameters.
- No system-output fallback.
- Device held and released correctly.
- Generation-stamped events.
- Basic typed errors.

Do not split writer, player, and router into separate owners. They are one lifecycle slice.

Review:

- The native-audio/concurrency specialist reviews the complete seam once.
- Owner fixes findings in one batch.
- Same specialist rechecks once.

### Slice C — Generalize formats, devices, and lifecycle failures

Add:

- Device discovery and stable IDs.
- Capability probing and tri-state truth.
- S24/S32 and the permitted lossless repack.
- Sample-rate/format changes between tracks.
- Partial writes, XRUN, suspension, busy/unplug.
- Seek, EOF, queue advancement, and teardown.

Use focused and affected tests throughout. Run the Rust subsystem suite at the slice boundary, not the entire frontend/build matrix after each internal step.

### Slice D — Product semantics, UI, and final verification

Add:

- Exclusive and Bit-perfect availability.
- Centralized Signal Path verdicts.
- Source quality distinction.
- Structured error alternatives.
- Audio Console and Signal Path UI.
- Unified snapshot revision authority.
- Documentation and acceptance evidence.

Specialist use:

- One frontend/state-authority reviewer for async snapshot merging and accessibility.
- One fresh integration reviewer for the complete branch.

### Expected agent topology

A reasonable high-risk run would use:

```text
Persistent root owner
├── Native-audio/concurrency specialist (consult + review + resumed recheck)
├── Frontend/state specialist (review + resumed recheck if needed)
├── Final integration reviewer
└── Optional diagnostician only if a repeated structural failure occurs
```

That is approximately three to four specialist identities, not 43. The owner remains responsible for implementation continuity.

A 90-percent reduction in agent identities is plausible for this topology. Token and wall-clock reductions must be benchmarked rather than promised; a reasonable initial product target is 60–80 percent fewer total tokens and 50–70 percent lower elapsed time while maintaining non-inferior hidden-test quality.

---

## 9. Plugin architecture

Suggested repository layout:

```text
zimster/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   ├── using-zimster/
│   │   └── SKILL.md
│   ├── mission-contract/
│   │   └── SKILL.md
│   ├── proof-first-development/
│   │   └── SKILL.md
│   ├── systematic-debugging/
│   │   └── SKILL.md
│   ├── risk-adaptive-review/
│   │   └── SKILL.md
│   ├── verification-ladder/
│   │   └── SKILL.md
│   └── finish/
│       └── SKILL.md
├── agents/
│   ├── scout.md
│   ├── test-specialist.md
│   ├── domain-reviewer.md
│   ├── integration-reviewer.md
│   └── diagnostician.md
├── scripts/
│   ├── zimster-init
│   ├── classify-risk
│   ├── affected-tests
│   ├── evidence
│   ├── budget
│   └── run-report
├── schemas/
│   ├── mission.schema.json
│   ├── evidence.schema.json
│   └── run.schema.json
└── evals/
```

### 9.1 Keep the skill set small

Six or seven skills are enough. Avoid a universal bootstrap that says a skill must be invoked before every response whenever there is a one-percent chance it applies. Progressive disclosure is more efficient:

- A compact bootstrap classifies the request.
- It loads only the relevant workflow.
- Domain specialists carry their own concise instructions.
- Long reference material is opened only when a live condition triggers it.

### 9.2 Separate policy from mechanism

Skills should express policy:

- Proof-first behavior.
- Risk classification.
- Review triggers.
- Finish states.

Scripts should enforce mechanism:

- Budgets.
- Nesting limits.
- Evidence caching.
- Affected-test selection.
- Model-routing records.
- Duplicate-command detection.
- Run telemetry.

Prompt-only enforcement is too easy for an orchestrator to forget or reinterpret.

### 9.3 Start independently, borrow selectively

Superpowers is MIT-licensed, so Zimster can legally reuse or adapt material while preserving the required copyright and license notice. Strategically, however, Zimster should not begin as a textual “slim fork.” Its primary innovation is a different execution architecture. Reusing concise TDD or debugging mechanisms may make sense; inheriting the per-task SDD loop as the core would undermine the goal.

---

## 10. Evaluation program

Zimster should not claim “same or better quality” until it is measured against both Superpowers and a bare frontier model.

### 10.1 Experimental arms

Use at least four paired arms:

| Arm | Purpose |
|---|---|
| Bare model | Establish frontier-model floor |
| Placebo/process-style prompt | Measure effect of confident process prose without mechanisms |
| Superpowers v6.2.x | Current framework baseline |
| Zimster balanced | Proposed default |

An optional fifth arm can test `Zimster assurance` mode.

### 10.2 Scenarios

Include more than small isolated coding tasks:

1. Existing go-fractals SDD scenario.
2. Planted-defect reviewer scenario.
3. Rust asynchronous lifecycle feature with hidden race/teardown tests.
4. React stale-response/state-authority feature.
5. Database migration with rollback and data-integrity checks.
6. Security-sensitive authorization change.
7. Reduced Atmosvox-style native-audio fixture with a fake PCM boundary and hidden integration checks.
8. A hardware-gated campaign when a controlled DAC environment is available.

### 10.3 Quality metrics

- Hidden acceptance pass rate.
- Critical and important defects after completion.
- Spec and invariant coverage.
- Mutation/falsifiability score for tests.
- Regression count.
- Overbuilding/scope deviation.
- Correct handling of unavailable evidence.
- Human review score, blinded and label-rotated.

### 10.4 Efficiency metrics

- Total input, cached, output, and reasoning tokens when available.
- Elapsed wall time.
- Main-agent and subagent turns.
- Agent starts, resumes, and nested spawns.
- Tool calls.
- Test command count.
- Duplicate command count.
- Full-suite count.
- Review waves and fix waves.
- Time and tokens to first integrated passing slice.
- Stage at which each defect was first discovered.

### 10.5 Release gates

Proposed initial gates, evaluated with paired runs and uncertainty intervals:

- No statistically meaningful increase in critical defects.
- Non-inferior hidden acceptance pass rate.
- Median total tokens no more than 50 percent of Superpowers.
- Median elapsed time no more than 60 percent of Superpowers.
- P95 specialist identities no greater than eight in balanced mode.
- Zero unapproved nested agents.
- Required external evidence never falsely reported as completed.

Use at least five runs per arm for stable scenarios, more for noisy ones. Treat single-run differences below approximately 20 percent cautiously.

### 10.6 Publish negative results

Zimster’s credibility will depend on showing where a shorter or cheaper mechanism fails. In particular:

- Do not assume cheap reviewers preserve judgment.
- Do not assume fewer instructions automatically reduce turns.
- Do not assume a detailed plan is always more expensive; exact invariants may prevent costly fix waves.
- Do not optimize solely for token count while shifting defects to users.

---

## 11. Initial product modes

### `fast`

For prototypes and low-risk changes:

- Persistent owner.
- No mandatory specialist.
- Focused tests and one final verification pass.
- One optional final reviewer for medium risk.

### `balanced` — recommended default

- Persistent owner.
- Risk-triggered seam reviews.
- Maximum five specialists.
- One recheck per gate.
- Full-suite budget of two.
- Fresh final integration reviewer for medium/high risk.

### `assurance`

For security, payments, migrations, destructive operations, and safety-critical work:

- Early domain pre-mortem.
- Required seam review for each high-risk boundary.
- Stronger evidence and mutation checks.
- Potentially larger specialist budget.
- Still no review after every arbitrary plan heading and no nested agent tree.

The mode changes the evidence and risk budget, not the fundamental ownership model.

---

## 12. Minimum viable Zimster release

The first release should prove the architecture rather than reproduce every Superpowers feature.

### MVP skills

1. `mission-contract`
2. `proof-first-development`
3. `systematic-debugging`
4. `risk-adaptive-review`
5. `verification-ladder`
6. `finish`

### MVP agents

1. Scout.
2. Domain reviewer.
3. Integration reviewer.
4. Diagnostician.

### MVP mechanisms

1. Run initialization and capability detection.
2. Risk classifier.
3. Explicit model/effort routing record.
4. Nesting prohibition.
5. Agent/turn/test budget ledger.
6. Evidence cache.
7. Final status matrix.
8. Run economics report.

### MVP evals

1. Go-fractals.
2. Planted defect.
3. Async Rust lifecycle.
4. React stale-state race.
5. One real project replay, ideally Atmosvox Goal 005 or a representative reduced branch.

---

## Final recommendation

Proceed with Zimster, but define it as an **optimized, risk-adaptive alternative** rather than “Superpowers Slim.” The latter sounds like fewer instructions. The real opportunity is much larger:

- Replace task-count-driven orchestration with risk-driven orchestration.
- Keep one capable owner on tightly coupled systems.
- Use specialists, not disposable general-purpose agents.
- Review architectural seams, not every checklist heading.
- Batch findings and permit one recheck.
- Enforce model, turn, nesting, and verification budgets in scripts rather than prose.
- Front-load the unknown that could invalidate the entire feature.
- Report precisely which kinds of verification were and were not achieved.

That design can plausibly preserve the best parts of Superpowers while removing the machinery that turned an important but bounded native-audio feature into a 43-agent, seven-hour run.
