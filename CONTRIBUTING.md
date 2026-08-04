# Contributing

1. Open an issue for behavioral workflow changes.
2. Use a feature branch/worktree and define commit disposition before editing.
3. Add or update a failing structural/behavioral test before policy changes.
4. Keep core skills harness- and operating-system-neutral.
5. Run `npm run sync:codex` after changing mirrored plugin content.
6. Run `npm run check`, `npm run version:check`, and `git diff --check`.
7. Inspect staged, unstaged, and untracked files with the change snapshot.
8. Record adapted material in `docs/UPSTREAM.md` and preserve its license.
9. Include paired evaluation evidence for claims of lower cost, faster runs, or
   better quality.
10. For public adapter changes, add isolated exact-package installation and
    fresh-session discovery fixtures; report unavailable hosts as blocked.

Pull requests should state stable requirement IDs, affected harnesses,
configuration/migration impact, verification evidence, and unavailable live
beta claims.

Use `npm run version:bump -- <version> --note "summary"` for releases. The
release tag must match all manifests and the changelog. Follow the full
`docs/RELEASING.md` checklist.

The project uses Node 22 and intentionally has no runtime dependencies.
