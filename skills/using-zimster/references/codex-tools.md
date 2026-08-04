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
- decide delegation usefulness before inspecting model mappings;
- after selection, propose an abstract capability class and resolve current
  configuration/catalog evidence at dispatch time;
- prefer per-spawn `model` and `reasoning_effort`, then an explicitly generated
  role config referenced by `[agents.<role>].config_file`, then inheritance;
- record requested and effective values with the dispatch recorder;
- use a named bounded task for exploration, review, or disjoint work;
- resume the same reviewer for a correction recheck;
- keep agent depth at one; subagents do not recruit agents;
- close agents after their bounded responsibility.

Treat `codex debug models` or app-server catalog output as session/version
evidence, not durable policy. Never edit the active Codex user configuration;
write optional snippets only to an explicit output. Strict-cost routing needs
both enforceability and effective-model evidence.

Pure reviewers should not receive shell tools. A test-capable reviewer gets one
named command plus mandatory plugin-relative `review-integrity.mjs` capture and
verify checks over immutable base/head SHAs.

When multi-agent tools are unavailable, execute inline and perform an explicit
adversarial self-review. State that independent-review assurance was not
available.
