# Zimster contributor instructions

- Use Node 22 or newer and add no runtime dependency without measured need.
- Keep core skills harness-neutral and operating-system-neutral.
- Add or update a failing structural/behavioral test before changing policy.
- Work on a feature branch/worktree; commit at verified vertical-slice
  boundaries unless the user explicitly requests no commits.
- Review `git status --short`, `git diff`, `git diff --cached`, and all untracked
  files before completion.
- Preserve third-party notices for adapted material.
- Do not add mandatory agents, nested delegation, or review loops without an
  evaluation showing a quality gain that justifies the economics.
- Synchronize the Codex mirror after canonical plugin changes.
- Run `npm run check`, `npm run version:check`, and `git diff --check` before
  completion.
