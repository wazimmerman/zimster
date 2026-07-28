# Claude Code mapping

Claude Code discovers root `skills/`, optional `agents/`, and `hooks/` through
the plugin. The SessionStart hook injects only `using-zimster`, not the full
library.

Operational helpers ship at the plugin root. Resolve them relative to the
installed plugin directory, not the user's target repository. Use the supplied
pure read-only agents for scouting/integration review and the tree-guarded
`test-reviewer` only when a focused command is necessary.

Configure a suitable model, effort, maximum turns, and restricted tools when
supported. Record requested and effective model values. The root conversation
remains implementation owner, and subagents cannot delegate further work.

Test a local checkout with Claude Code's plugin-directory development option
and inspect hook output before marketplace publication.
