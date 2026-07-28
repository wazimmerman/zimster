# Other harnesses

- **Cursor:** root skills plus the Cursor SessionStart hook.
- **Kimi Code:** native skills; the manifest maps planning, exploration, coding,
  and task tools while keeping delegation depth one.
- **OpenCode:** the adapter registers `skills/` and injects the compact
  bootstrap into the first user message once. If a release changes OpenCode's
  config lifecycle, users may add the skills path manually.
- **Pi:** the extension registers skills and injects the bootstrap on session
  start or compaction. Subagents are optional and depend on installed Pi
  extensions.

Harness adapters may change faster than core skills. Keep workflow language
harness-neutral and isolate tool names in these references and adapter files.
