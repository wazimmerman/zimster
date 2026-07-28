# Porting Zimster

A harness integration has three responsibilities:

1. expose `skills/` through native discovery or a documented path;
2. load only the compact `using-zimster` bootstrap when native skill selection
   needs help;
3. map bounded delegation, task tracking, file operations, shell execution, and
   web access to native tools without changing core policy.

## Invariants

- core skills remain harness-neutral and OS-neutral;
- subagent depth is one;
- the root remains implementation owner;
- absence of subagents has an inline fallback;
- requested and effective model routing are distinguished;
- bootstrap injection is idempotent and not repeated every turn;
- user and repository instructions take precedence;
- adapters add no telemetry, credentials, or network dependency.

## Adapter test checklist

- skills are discoverable;
- `using-zimster` appears once at session start and after compaction when
  required;
- no full-library eager injection occurs;
- Windows, macOS, and Linux path handling is exercised;
- model/effort overrides are recorded or marked unverified;
- an unavailable agent tool falls back inline;
- package contents and file modes are deterministic.
