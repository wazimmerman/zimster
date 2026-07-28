# OpenAI Codex plugin contract snapshot

Zimster's local Codex validator is a compact JavaScript port of the accepted
manifest and repo-marketplace checks in the official `openai/codex`
plugin-creator skill. The contract snapshot is pinned to upstream validator
blob `88fae0fd00998ea32fa2393869042f0231a2b43b` and records the source files in
`manifest-contract.json`.

Upstream repository: <https://github.com/openai/codex>

The upstream code and documentation are licensed under the Apache License 2.0.
Zimster does not claim this port is a substitute for a live Codex ingestion
smoke test; it prevents known schema and layout drift without requiring network
access during CI.
