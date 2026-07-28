# Codex mapping

Codex is Zimster's priority harness. The repository marketplace points to the
self-contained `plugins/zimster/` directory. The Codex manifest contains only
fields accepted by the current Codex plugin contract; Claude hooks are outside
the Codex plugin tree.

Operational helpers (`scripts/`, `config/`, `schemas/`, and `templates/`) ship
inside the plugin. Resolve commands from the installed Zimster plugin root—the
parent containing `.codex-plugin/plugin.json`—not from the user's target
repository. Normal run artifacts live under the target worktree's Git-local
`zimster` administrative directory, outside product history.

When multi-agent tools are available:

- keep the root thread as persistent implementation owner;
- choose the abstract tier in `config/model-routing.json`;
- pass explicit `model` and `reasoning_effort` overrides when supported and
  justified;
- record requested and effective values with the dispatch recorder;
- use a named bounded task for exploration, review, or disjoint work;
- resume the same reviewer for a correction recheck;
- keep agent depth at one; subagents do not recruit agents;
- close agents after their bounded responsibility.

Pure reviewers should not receive shell tools. A test-capable reviewer gets one
named command plus mandatory plugin-relative `review-integrity.mjs` capture and
verify checks over immutable base/head SHAs.

When multi-agent tools are unavailable, execute inline and perform an explicit
adversarial self-review. State that independent-review assurance was not
available.
