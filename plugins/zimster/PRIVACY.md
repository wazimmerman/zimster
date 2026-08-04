# Privacy

Zimster itself does not collect, transmit, or store telemetry, prompts, source
code, credentials, or personal data. It is a local package of skills, adapter
files, and maintenance scripts.

Git-local run state, evidence receipts, dispatch records, routing observations,
configuration snapshots, and change snapshots live beneath the path returned
by `git rev-parse --git-path zimster`. They remain on the user's machine and are
not committed by default. Zimster contains no upload mechanism.

Optional user and project model mappings may contain provider and model names.
Diagnostics report layer digests and counts without revealing concrete mapping
contents by default. Zimster never stores provider credentials or edits active
host configuration automatically.

The coding harness, models, shell commands, plugins, MCP servers, and external
services a user chooses remain governed by their own privacy policies and
workspace controls. Review those systems before giving an agent access to
private repositories or data.
