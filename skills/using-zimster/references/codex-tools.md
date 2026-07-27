# Codex mapping

Codex is Zimster's priority harness. Use native skill discovery from the plugin
manifest. The Codex manifest deliberately contains `hooks: {}` so Codex does
not auto-discover the Claude SessionStart hook.

When multi-agent tools are available:

- keep the root thread as persistent implementation owner;
- set `model` and `reasoning_effort` explicitly only when the role warrants an
  override, and record the effective values returned by the harness;
- use a named bounded task for exploration, review, or independent work;
- resume the same reviewer for a correction recheck;
- set or respect an agent depth limit of one; subagents do not recruit agents;
- close agents when their bounded responsibility is complete.

When multi-agent tools are unavailable, execute inline and use an explicit
adversarial self-review. State that independent-review assurance was not
available.
