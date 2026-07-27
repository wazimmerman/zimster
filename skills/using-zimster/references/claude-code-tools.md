# Claude Code mapping

Claude Code discovers root `skills/`, optional `agents/`, and `hooks/` through
the plugin. The SessionStart hook injects only `using-zimster`, not the whole
skill library.

Use subagents only for bounded roles. Configure a suitable model, effort,
maximum turns, and restricted tools when supported. The root conversation
remains the implementation owner. A subagent cannot delegate further work.

Test a local checkout with Claude Code's plugin-directory development option
and inspect hook output before marketplace publication.
