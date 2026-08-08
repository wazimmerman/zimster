# Zimster benchmarks

This directory contains public, reproducible inputs and dependency-free analysis
code. It intentionally does not contain raw model traces.

- `lock/deepswe-v1.1.json` pins benchmark, harness, Codex, model, and reasoning.
- `manifests/codex-pro-pilot.json` freezes task selection and campaign sizes.
- `lib/pilot.mjs` plans pairs, enforces safety invariants, imports Pier results,
  and computes paired estimates.
- `../schemas/benchmark-result.schema.json` defines each public run record.
- `../schemas/benchmark-campaign-result.schema.json` defines the published
  campaign summary, including its treatment-source provenance.

The runner stores mutable state and content-addressed evidence under the Git
directory (`.git/zimster/benchmarks/`) by default. This keeps large traces and
credential-adjacent logs outside commits and release archives. See
`docs/EVALUATION.md` for the complete protocol and commands.

The preflight's auto-top-up flag is an operator assertion, not an account API
query. Pass it only after checking the subscription settings. A successful
preflight proves the local CLI reports ChatGPT authentication and that no known
API/provider environment override is present; it does not guarantee future
subscription capacity.
