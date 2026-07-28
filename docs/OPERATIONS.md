# Operational Controls

## Locating the tools

The tools live in the installed Zimster plugin, not in the user's project.
Resolve the Zimster root as the parent containing the harness manifest (for
Codex, `.codex-plugin/plugin.json`). Run tools with an absolute path while the
working directory is the target repository.

## Durable run state

```text
node <zimster>/scripts/init-run.mjs \
  --profile high-risk \
  --reason "public plugin compatibility" \
  --triggers "more than one vertical slice,independent review" \
  --commit-policy "commit at verified slice boundaries"
```

The command refuses to overwrite an existing run unless `--force` is explicit.
Normal state is written beneath `git rev-parse --git-path zimster`. Use
`--audit-path docs/<project-defined-path>.md` only for an explicit audit-mode
contract. Zimster does not edit tracked `.gitignore` for normal state.

## Canonical command inventory

```text
node <zimster>/scripts/project-commands.mjs <target-repository>
```

The JSON output lists repository instructions, package scripts, Make/Just/Task
entries, language tooling, and simple CI `run:` commands. It is an inventory,
not a claim that every listed command is required.

## Complete change snapshot

```text
node <zimster>/scripts/change-snapshot.mjs \
  --base <merge-base> \
  --output /path/from/git-rev-parse/zimster/change-snapshot.md
```

The snapshot contains the committed branch range, staged and unstaged diffs,
status, and every untracked file. Text files are embedded; large/binary files
are represented by size and SHA-256. The index is unchanged.

## Evidence receipts

Initialize or record supplied evidence:

```text
node <zimster>/scripts/evidence.mjs init
node <zimster>/scripts/evidence.mjs record \
  --kind test --scope focused --command "npm test" --exit-code 0 \
  --test-discovery tests_executed --tests-passed 42 --tests-failed 0 \
  --dependencies "src/cache.js,test/cache.test.js"
```

Run and record a command:

```text
node <zimster>/scripts/evidence.mjs run \
  --kind test --scope affected --test-discovery tests_executed -- \
  npm test
```

Check or find reusable proof:

```text
node <zimster>/scripts/evidence.mjs check --id <receipt-id>
node <zimster>/scripts/evidence.mjs find \
  --kind test --scope focused --command "npm test"
```

Receipts become stale when the complete working-tree fingerprint changes.
`--reuse` is allowed only for non-final work; final gates are rerun.

Test-discovery values are `not_reached`, `zero_discovered`, `tests_executed`,
and `unknown`. An agent should supply exact counts rather than infer them from a
zero exit code.

## Dispatch records

```text
node <zimster>/scripts/dispatch-record.mjs record \
  --role scout --purpose "locate state authority" --tier fast \
  --requested-model fast-default --requested-effort low \
  --parent-model expert-parent --turn-limit 12 \
  --commit-permission none --output <git-local-zimster-path>/scout.md
```

After the harness reports effective routing:

```text
node <zimster>/scripts/dispatch-record.mjs update \
  --id <dispatch-id> --effective-model <name-or-unverified> \
  --effective-effort <value-or-unverified> --agent-id <id>
```

A fast role that actually used the parent model is marked with a warning.

## Release controls

```text
npm run version:bump -- 0.3.0 --note "Release summary"
npm run version:check
npm run sync:codex:check
npm run check
npm run checksums
```

`version:bump` updates package/lock versions, four primary manifests, Claude
marketplace entry, changelog heading, and the generated Codex mirror.
`version:check -- --tag v0.3.0` additionally validates a release tag.

## Privacy

All Git-local evidence, dispatch, snapshot, and run files remain on the local
machine. Zimster contains no upload or telemetry mechanism. Pass `--no-receipt`
or set `ZIMSTER_RECEIPTS=off` to run without recording receipt state.
