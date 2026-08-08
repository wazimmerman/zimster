<p align="center">
  <img
    src="assets/zimster-logo.png"
    alt="Zimster"
    width="720"
  >
</p>

<p align="center">
  <strong>One development workflow for coding agents, without the agent sprawl.</strong>
</p>

<p align="center">
  <a href="docs/INSTALL.md">Install</a>
  ·
  <a href="docs/CONFIGURATION.md">Configure</a>
  ·
  <a href="https://github.com/wazimmerman/zimster/releases">Releases</a>
  ·
  <a href="docs/ARCHITECTURE.md">Documentation</a>
  ·
  <a href="https://github.com/wazimmerman/zimster/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/wazimmerman/zimster/releases/tag/v0.6.0"><img alt="Current public-beta release: v0.6.0" src="https://img.shields.io/badge/public_beta-v0.6.0-5b8def"></a>
  <a href="https://github.com/wazimmerman/zimster/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/wazimmerman/zimster/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2ea44f"></a>
</p>

## What Zimster is

Zimster brings planning, specifications, TDD, debugging, review, delegation,
durable work context, and verification into one software development workflow.
One agent stays responsible for the result. Zimster adds process or agents only
when the work calls for them.

It covers capabilities that are often split across several coding-agent skills,
plugins, or workflow systems. It is meant to work alongside the development
tools a project already uses, not replace every coding plugin.

## Quick start

### Codex

Clone the repository, register it as a Git/custom marketplace, and install the
plugin:

```text
git clone https://github.com/wazimmerman/zimster.git
codex plugin marketplace add /absolute/path/to/zimster
codex plugin add zimster@zimster --json
```

This is the current public Codex installation path; Zimster does not claim an
official OpenAI Plugin Directory listing. See the
[installation guide](docs/INSTALL.md) for isolated validation, updates,
rollback, and uninstall.

### Claude Code

Add the GitHub repository as a marketplace and install its plugin:

```text
claude plugin marketplace add wazimmerman/zimster
claude plugin install zimster@zimster
```

This uses Zimster's GitHub marketplace and does not claim an official Claude
marketplace listing.

### Skills only

Portable skills can be synchronized from a checkout or extracted archive when
a host-specific plugin is not appropriate. Follow the
[skills-only installation instructions](docs/INSTALL.md)
for the supported command and limitations.

## How to use Zimster

After installation, work with your coding agent the way you already do. Describe
the software work you want done. You do not need to know Zimster's internal
skill names or construct a large workflow prompt. Zimster selects the smallest
appropriate workflow for the request and its risk.

Natural requests are enough:

- "Help me start a new project and decide what to build first."
- "Add or change the account settings behavior."
- "Debug why these background jobs sometimes stop."
- "Refactor this module without changing its public behavior."
- "Review this implementation before I merge it."
- "Help me choose an architecture for this consequential product change."

Advanced users can ask explicitly to use Zimster or invoke an individual skill
when their host supports it. Invocation syntax differs by host; see the
[installation guide](docs/INSTALL.md) and the matching host guide.

## Features

### Design, specifications, and planning

Zimster uses a risk-adaptive form of spec-driven development. Exact, low-risk
work can proceed directly. Material ambiguity gets compact design, while major
product, architecture, UX, security, migration, public-contract, or expensive
choices get deeper collaborative design. Oversized requests are separated into
bounded workstreams only when one plan would stop being coherent.

The workflow reads relevant project context before asking questions, separates
current system truth from proposed changes, keeps accepted decisions distinct
from unresolved proposals, and requires human approval before a proposal becomes
durable project knowledge. Plans preserve requirement IDs, architecture,
dependencies, coherent vertical slices, and evidence obligations. Plan
conformance is checked at slice boundaries and before release.

Specification and TDD are complementary: specifications establish what should
be built, while TDD drives and verifies implementation behavior.

```text
requirements and specification
→ architecture and design where needed
→ implementation plan
→ TDD and implementation
→ review and integration evidence
→ requirement and evidence completion
```

### Implementation and debugging

One persistent owner carries the work through coherent vertical slices. The
workflow uses behavior-specific RED-GREEN-REFACTOR, systematic root-cause
debugging, safe refactoring, and explicit Git or worktree isolation. Parallel
implementation is available only for genuinely independent workstreams.

### Review and verification

Review depth follows risk and concentrates on load-bearing seams. Zimster covers
review feedback adjudication, requirement-to-evidence mapping, stale-evidence
detection, exact-head verification, and staged, unstaged, and untracked changes.
Unavailable service, hardware, human, or reviewer proof narrows the completion
claim instead of being presented as success.

### Delegation and model use

Delegation must materially improve the task before model selection begins.
Delegated roles are bounded, parallelism is limited, and subagents do not recruit
more subagents. Vendor-neutral capability classes keep task needs separate from
specific model names. Requested and effective models are reported separately
when the host exposes that information.

### Continuity and bounded automation

Compact Git-local journals preserve the mission, decisions, evidence, and next
slice across context renewal or compaction. Deterministic corrections can
continue within explicit evidence and execution budgets. Receipts bind proof to
the relevant candidate, command, environment, and dependency scope, while build
metadata preserves package provenance.

### Portability

Canonical Agent Skills and an Agent Plugins manifest support portable,
skills-only use. Host-specific packaging covers Codex, Claude Code, Grok Build,
OpenCode, Pi, and Kimi Code, with the precise evidence level for each host shown
below. Structural validation and installability are not treated as model-backed
execution proof.

## How the workflow works

```text
classify risk and Git disposition
→ design only when meaningful choices exist
→ plan coherent vertical slices
→ persistent owner implements with RED-GREEN-REFACTOR
→ delegate only when it materially helps
→ verify affected behavior
→ review risky seams
→ correct within bounded convergence rules
→ independently review the exact final head
→ map requirements to evidence
→ make only supported completion claims
```

The workflow scales planning, review, and proof with the risk of the change
while keeping implementation ownership continuous.

## Model-aware delegation

Zimster first decides whether delegation is useful. The availability of a
cheaper model never causes delegation; only a selected, bounded task receives a
model proposal. Proposals remain separate from user mappings so recommendations
cannot silently become routing policy.

Routing can use recommendation (`recommend`), mapping-only (`map_only`),
automatic-within-policy (`auto_within_policy`), or inherited (`inherit`)
behavior. Abstract capability classes (`economy`, `balanced`, `expert`, and
`inherit`) describe task needs rather than hardcoded vendor models. The
persistent owner verifies delegated implementation, and Zimster reports routing
enforcement and the effective model only when the harness exposes that evidence.

See [configuration](docs/CONFIGURATION.md) for mappings, precedence, fallback
rules, and convergence controls.

## Workflow profiles

| Profile | Selected when | Independent review | Expected proof |
|---|---|---|---|
| **Micro** | One local, deterministic, low-risk slice; every risk dimension is Low | Not required when every Micro condition is satisfied | Fresh owner verification of the focused and affected behavior |
| **Standard** | Medium-risk subsystem or multi-component work with no High-risk trigger | Required at the concentrated seam or integration point | Focused and affected proof tied to the exact candidate |
| **High risk** | Security, public compatibility, concurrency ownership, destructive migration, native boundaries, unstable services, broad architecture, or another hard trigger | Load-bearing review plus exact-final-head independent review | Stronger integration proof for every load-bearing obligation |

## Supported harnesses

Version 0.7.0 uses claim-scoped support levels. Installation availability and
structural validation do not imply live, model-backed execution.

| Harness | Current verification level | Installation path | Principal limitation |
|---|---|---|---|
| Codex 0.146.1 | `INSTALLED_PACKAGE_VERIFIED` | Full Codex ZIP or Git/custom marketplace | Isolated registration and installation passed; no comparative benchmark covers the changed final v0.7 candidate |
| Claude Code 2.1.224 | `STRUCTURALLY_VALIDATED` | Full Claude ZIP or GitHub marketplace | The exact package structure validates with 12 skills, 4 agents, and the SessionStart hook; isolated installation and model-backed execution are not established |
| Grok 1.0.0 | `STRUCTURALLY_VALIDATED` | Portable Agent Plugin ZIP | The root manifest and all 12 skills validate structurally; isolated installation, skill discovery, and model-backed execution are not established |
| Kimi Code | `UNAVAILABLE` | Primary npm package or copied skills | The CLI was absent, so only the documented adapter structure was validated |
| OpenCode 1.18.13 | `LIVE_VERIFIED` | Primary npm package or copied skills | Exact npm-package skill discovery passed; model-backed execution was not run |
| Pi 0.84.1 | `INSTALLED_PACKAGE_VERIFIED` | Primary npm package | Isolated package installation passed; optional delegation remains disabled by default |

The vocabulary is intentionally narrow:

- `LIVE_VERIFIED`: the named live behavior was observed on the current host.
- `INSTALLED_PACKAGE_VERIFIED`: exact-package installation and package
  integrity passed, without implying model-backed execution.
- `STRUCTURALLY_VALIDATED`: the package or adapter conforms to validated
  structure, without a live-support claim.
- `BLOCKED_BY_AUTHENTICATION`: the live check reached an authentication
  boundary that prevented proof.
- `UNAVAILABLE`: the required host or capability was not present.
- `UNSUPPORTED`: Zimster does not provide the claimed integration.

For the complete evidence matrix, including what was tested, what was not
tested, installation availability, and known limitations, see the harness guides in
[the documentation](#documentation) and run `npm run doctor -- --json` from a
checkout or package.

## Verification and trust

Zimster keeps owner `self_review`, reviewer checkout integrity, independent
semantic approval, and candidate completion separate. No single status stands
in for the others.

- Stable requirement IDs feed a requirement-to-evidence matrix with explicit
  claim and evidence scope.
- Evidence receipts bind commands to the relevant tree and dependency cone,
  allowing stale results to be detected.
- Exact-head review covers committed ranges plus staged, unstaged, and untracked
  files.
- Package layout, archives, and checksums are validated deterministically.
- Partial, unavailable, and environment-blocked states remain visible instead
  of being promoted to readiness.

The detailed assurance state machine and operational controls are documented in
[Architecture](docs/ARCHITECTURE.md) and [Operations](docs/OPERATIONS.md).

## Documentation

| Topic | Guide |
|---|---|
| Installation and lifecycle | [Install](docs/INSTALL.md) |
| Routing and convergence | [Configuration](docs/CONFIGURATION.md) |
| Current constraints | [Known limitations](docs/KNOWN_LIMITATIONS.md) |
| System design | [Architecture](docs/ARCHITECTURE.md) |
| Commands and evidence | [Operations](docs/OPERATIONS.md) |
| Quality and economics | [Evaluation](docs/EVALUATION.md) |
| Tested host capabilities | [Compatibility](docs/COMPATIBILITY.md) |
| Planned work | [Roadmap](docs/ROADMAP.md) |
| User support | [Support](SUPPORT.md) |
| Data handling | [Privacy](PRIVACY.md) |
| Terms | [Terms](TERMS.md) |
| Licensing provenance | [Third-party notices](THIRD_PARTY_NOTICES.md) |

Harness-specific installation and evidence details are available for
[Codex](docs/CODEX.md), [Claude Code](docs/CLAUDE.md),
[Grok](docs/GROK.md), [Kimi Code](docs/KIMI.md),
[OpenCode](docs/OPENCODE.md), and [Pi](docs/PI.md).
The retained [Cursor adapter](docs/CURSOR.md) is an ancillary skills-only
surface and is not one of the v0.7.0 release-authorization hosts.

## Public-beta status and known limitations

Version 0.7.0 is a release candidate. The latest published release remains
0.6.0 until the signed release authorization succeeds. The core workflow is
usable, while evidence
levels differ by harness and live model-backed testing has not been completed
for every integration. Review the [known limitations](docs/KNOWN_LIMITATIONS.md)
before adoption.

The completed DeepSWE pilot is historical evidence for pre-change commit
`95dfedf7d396a7b9faa72ced844a28f70bd6bcef`. It is not a benchmark of the
changed final v0.7 candidate. See [Evaluation](docs/EVALUATION.md) for the exact
result and the cost-planned path to future comparative evidence.

Reproducible issue reports should include the Zimster version, harness version,
selected workflow profile, and relevant `doctor` or postmortem output.

## Contributing, support, and security

Contributions are welcome through the
[contribution guide](https://github.com/wazimmerman/zimster/blob/main/CONTRIBUTING.md).
Use [Support](SUPPORT.md) for help, the
[issue tracker](https://github.com/wazimmerman/zimster/issues) for reproducible
defects, and the
[security policy](https://github.com/wazimmerman/zimster/blob/main/SECURITY.md)
for private vulnerability-reporting instructions.

## License and acknowledgments

Zimster is available under the [MIT License](LICENSE).

Zimster builds on proven ideas from Superpowers and other agentic development
workflows while using its own owner-driven, risk-adaptive execution model. See
[Upstream provenance](docs/UPSTREAM.md), [Compatibility](docs/COMPATIBILITY.md), and
[Third-party notices](THIRD_PARTY_NOTICES.md) for attribution and licensing
details.
