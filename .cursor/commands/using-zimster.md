Use the `using-zimster` Agent Skill for this task. Read its complete `SKILL.md`
before acting, select and report the risk profile, and follow its proof-first
workflow.

Decide delegation usefulness before model routing. Inherit the current model by
default; use an explicitly generated custom-agent override only when this Cursor
version reports compatible model fields, and report effective routing as
unverified when the host does not expose it.

If the skill is not discoverable in this repository, refresh the repository
skills from a Zimster checkout or extracted package:

`npm run sync-skills -- --target /path/to/this/repository`

Treat a missing skill after synchronization as an installation error. Expected
missing harness capabilities use the quiet fallback recorded by the skill; use
the Zimster doctor command when detailed diagnostics are wanted.
