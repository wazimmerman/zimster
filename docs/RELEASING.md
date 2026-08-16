# Release authorization

Zimster releases are cut from a clean, reviewed feature branch. A release is
authorized by a signed annotated tag whose message is exactly one canonical
release-evidence JSON payload. CI verifies that authorization; it never creates
semantic approval.

The owner's private signing key remains local. CI derives the primary
fingerprint from the checked-in public verification key, requires it to match
the protected `RELEASE_SIGNER_FINGERPRINT` environment variable, and only then
imports it into an ephemeral GPG keyring. Both `git verify-tag` and the later
`release:evidence verify-tag` fingerprint check must pass.

No npm publication, marketplace submission, public GitHub release, tag, or paid
credit purchase is permitted without explicit owner authorization.

## Prepare the candidate

Synchronize versions through the repository command:

```text
npm run version:bump -- <next-version> --note "Release summary"
```

For v0.7.1 the candidate must satisfy the standards lock, canonical/generated
mirror equality, current host evidence, benchmark evidence policy, and
plan-conformance gate. Registry acceptance is a later external event, not a tag
gate.

Run fresh verification after the last edit:

```text
npm run sync:codex:check
npm run release:verify
npm run check
npm run version:check
npm run version:check -- --tag v<next-version>
npm run checksums
npm run plan:conformance -- --phase release
npm run postmortem
git diff --check
```

Inspect `git status --short`, `git diff`, `git diff --cached`, and every
untracked file. A correction invalidates affected evidence and exact-head
review. Re-run the applicable checks on the corrected tree.

## Build the five artifacts

`npm run package` builds, from one canonical source tree:

- the portable Agent Plugin ZIP;
- the full Codex plugin ZIP;
- the full Claude plugin ZIP;
- the OpenAI skills-plugin submission ZIP with bundled supporting code; and
- the primary npm/Pi package tarball.

Build twice from independent clean checkouts and require byte-identical files
and inventories. Validate archive paths, embedded build metadata, SHA-256
digests, npm allowlist exclusions, and absence of credentials or private
planning material. Smoke-test each available host in a fresh isolated home and
record unavailable capabilities without broadening the claim.

Run installed-package smoke before the final integration review. In particular,
register and install the exact Codex ZIP with an isolated `CODEX_HOME`. Run the
secret scan over both tracked content and every artifact before accepting the
checksums.

## Create release evidence

The canonical payload conforms to `schemas/release-evidence.schema.json` and
binds the version, tag, channel, commit, tree, standards-lock hash,
semantic-review hash, host-matrix hash, verification results, artifact names,
and SHA-256 digests. Generate and validate it with the release-evidence tools,
then place that exact JSON in a signed annotated tag targeting the reviewed
commit.

Never move, delete, or recreate a published tag. Correct a released defect with
a patch version.

## Verification-only CI

Release CI must:

1. validate the tag signature, signer, exact target, and JSON schema;
2. rebuild from the tagged tree in a clean environment;
3. compare every artifact name and digest with the signed payload;
4. generate attestations;
5. create or update an idempotent draft GitHub release;
6. publish npm first; and
7. expose the matching GitHub draft only after npm succeeds.

The verified signed channel controls GitHub release state. `public_beta` uses
the `Zimster <version> - Public Beta` title, is a prerelease, and is never
Latest. `stable` is not a prerelease and intentionally becomes Latest. Reruns
reapply the authorized state only to the release for the signed tag.

Invalid signatures, wrong targets, dirty inputs, changed payloads, digest
mismatches, duplicate publication, and npm failure must fail closed. CI must not
replace missing human review or create a release authorization.
