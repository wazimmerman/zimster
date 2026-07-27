# Zimster contributor instructions

- Use Node 22 or newer and add no runtime dependency without a measured need.
- Keep core skills harness-neutral and operating-system-neutral.
- Write or update a failing structural/behavioral test before changing policy.
- Preserve third-party notices for adapted material.
- Do not add mandatory agents, nested delegation, or review loops without an
  evaluation showing a quality gain that justifies the economics.
- Run `npm run check` and `git diff --check` before completion.
