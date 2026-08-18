# Release authorization

Zimster releases are cut from a clean, reviewed feature branch. A release is
authorized by a signed annotated tag whose message is exactly one canonical
release-evidence JSON payload. CI verifies the human release authorization; it
does not manufacture runtime `CANDIDATE_COMPLETE` or host-authenticated reviewer
provenance.

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

For v0.7.2 the candidate must satisfy the standards lock, canonical/generated
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

The schema-v2 canonical payload conforms to
`schemas/release-evidence.schema.json`. It binds the version, tag, channel,
commit, tree, standards-lock hash, semantic-review hash, host-matrix hash,
verification hash, and the exact five artifact names, sizes, and SHA-256
digests. It also embeds exactly `semantic-review.json`, `host-matrix.json`, and
`verification.json` as canonical padded Base64 whose decoded bytes must match
the signed digests. Each input is limited to 1 MiB, their decoded aggregate is
limited to 2 MiB, and the canonical tag payload is limited to 3 MiB.

After the final release commit and artifacts exist, create the payload with the
exact commit/tree, artifact directory, standards lock, and three
candidate-specific evidence files from local or Git-local qualification state:

```text
npm run release:evidence -- create \
  --version <version> --tag v<version> --channel public_beta \
  --commit <full-commit-sha> --tree <full-tree-sha> \
  --standards-lock config/standards-lock.json \
  --semantic-review <qualified-semantic-review.json> \
  --host-matrix <qualified-host-matrix.json> \
  --verification <qualified-verification.json> \
  --dist dist --output <release-evidence.json>
```

The evidence files and generated payload do not need to be committed. Place
the generated JSON, unchanged, in a signed annotated tag targeting that commit.

The three inputs are closed, candidate-bound JSON records rather than opaque
attachments. The semantic review must be the exact-head independent integration
review, truthfully state reviewer provenance, be approved, and contain no
unresolved Critical or Important finding. Host-matrix and verification records
must use the supported release-facing schemas. Verification log references are
portable logical IDs plus hashes, never local paths. Creation and extraction
reject secrets, private keys, user-profile paths, temporary paths, and
Git-local Zimster runtime paths before bytes can enter permanent public tag
history. An accepted tag records `HUMAN_RELEASE_REVIEW_ACCEPTED`; it does not
alter runtime semantic-assurance state.

The successful `release:verify` receipt names a separate portable
`release_input`. That `verification.json` carries the exact canonical review
authorization binding evaluated locally: review ID and declared provenance,
candidate base/head/tree, review-package ID, requirement-matrix and
semantic-contract digests, and required lenses. Release-evidence creation and
signed-tag verification pass that binding and the embedded semantic review to
the same pure authorization evaluator used by local semantic assurance. The tag
path therefore cannot accept weaker review semantics than the local release
gate.

Never move, delete, or recreate a published tag. Correct a released defect with
a patch version.

## Verification-only CI

Release CI must:

1. validate the annotated tag signature, signer, and exact peeled target;
2. rebuild from the tagged tree in a clean environment;
3. extract the exact three bounded inputs from the verified signed tag into a
   temporary directory;
4. compare every input byte, artifact name, and artifact digest with the signed
   payload;
5. generate attestations;
6. create or update an idempotent draft GitHub release;
7. publish npm first; and
8. expose the matching GitHub draft only after npm succeeds.

The verified signed channel controls GitHub release state. `public_beta` uses
the `Zimster <version> - Public Beta` title, is a prerelease, and is never
Latest. `stable` is not a prerelease and intentionally becomes Latest. Reruns
reapply the authorized state only to the release for the signed tag.

Invalid signatures, wrong targets, dirty inputs, changed payloads, digest
mismatches, duplicate publication, and npm failure must fail closed. CI must not
replace missing human review or create a release authorization.
