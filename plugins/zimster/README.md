<p align="center">
  <img
    src="assets/zimster-logo.png"
    alt="Zimster"
    width="720"
  >
</p>

<p align="center">
  <strong>Proof-first development without orchestration bloat.</strong>
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

Zimster is a proof-first software-development workflow for capable coding
agents. It is built for developers and engineering teams that want one
persistent implementation owner, meaningful RED-GREEN-REFACTOR, selective
delegation, risk-focused review, and fresh evidence behind every completion
claim—without making multi-agent orchestration the default.

## Why developers use it

- **Coherent ownership:** one persistent owner carries context across design,
  implementation, correction, and verification.
- **Behavior-specific TDD:** tests demonstrate that each load-bearing behavior
  can fail before implementation makes it pass.
- **Bounded delegation:** separate workers are used only for tasks where the
  expected benefit justifies the coordination cost.
- **Risk-adaptive review:** independent review concentrates on architectural
  seams and integration points where defects would matter most.
- **Evidence-backed completion:** fresh, scoped proof supports each requirement
  and prevents stale results from becoming completion claims.
- **Honest unavailable-proof states:** blocked environments, missing services,
  and unavailable reviewers narrow the claim instead of being treated as
  success.
- **Deliberate model selection:** routing begins only after delegation has
  already been justified.
- **Bounded autonomous correction:** ordinary deterministic failures are fixed
  within an explicit convergence budget without unnecessary interruption.

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

The workflow scales its planning, review, and proof requirements with the risk
of the change while keeping implementation ownership continuous.

## Model-aware delegation

Zimster first decides whether delegation is useful. The availability of a
cheaper model never causes delegation; only a selected, bounded task receives a
model proposal. Proposals remain separate from user mappings so recommendations
cannot silently become routing policy.

Routing can use recommendation (`recommend`), mapping-only (`map_only`),
automatic-within-policy (`auto_within_policy`), or inherited (`inherit`)
behavior. Abstract capability classes—`economy`, `balanced`, `expert`, and
`inherit`—describe task needs rather than hardcoded vendor models. The
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
| Codex 0.146.1 | `INSTALLED_PACKAGE_VERIFIED` | Full Codex ZIP or Git/custom marketplace | Isolated registration and installation passed; model-backed task execution is evaluated separately |
| Claude Code 2.1.224 | `STRUCTURALLY_VALIDATED` | Full Claude ZIP or GitHub marketplace | The exact package structure validates with 12 skills, 4 agents, and the SessionStart hook; isolated installation and model-backed execution are not established |
| Grok 1.0.0 | `STRUCTURALLY_VALIDATED` | Portable Agent Plugin ZIP | The root manifest and all 12 skills validate structurally; isolated installation, skill discovery, and model-backed execution are not established |
| Kimi Code | `UNAVAILABLE` | Primary npm package or copied skills | The CLI was absent, so only the documented adapter structure was validated |
| OpenCode 1.18.13 | `LIVE_VERIFIED` | Primary npm package or copied skills | Exact npm-package skill discovery passed; model-backed execution was not run |
| Pi 0.84.1 | `INSTALLED_PACKAGE_VERIFIED` | Primary npm package | Isolated package installation passed; optional delegation remains disabled by default |

The vocabulary is intentionally narrow:

- `LIVE_VERIFIED` — the named live behavior was observed on the current host.
- `INSTALLED_PACKAGE_VERIFIED` — exact-package installation and package
  integrity passed, without implying model-backed execution.
- `STRUCTURALLY_VALIDATED` — the package or adapter conforms to validated
  structure, without a live-support claim.
- `BLOCKED_BY_AUTHENTICATION` — the live check reached an authentication
  boundary that prevented proof.
- `UNAVAILABLE` — the required host or capability was not present.
- `UNSUPPORTED` — Zimster does not provide the claimed integration.

For the complete evidence matrix—what was tested, what was not tested,
installation availability, and known limitations—see the harness guides in
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
