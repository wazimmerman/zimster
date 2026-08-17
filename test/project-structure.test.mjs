import test from 'node:test';
import assert from 'node:assert/strict';
import { exists, json } from './helpers.mjs';

const requiredFiles = [
  'plugin.json',
  '.codex-plugin/plugin.json',
  'templates/codex-agents/zimster-integration-reviewer.toml',
  '.claude-plugin/plugin.json',
  '.cursor/commands/using-zimster.md',
  '.kimi-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  '.opencode/plugins/zimster.js',
  '.pi/extensions/zimster.ts',
  '.pi/delegation.ts',
  'hooks/hooks.json',
  'hooks/session-start.mjs',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md',
  'docs/EVALUATION.md',
  'docs/DIAGNOSTICS.md',
  'docs/INSTALL.md',
  'docs/CONFIGURATION.md',
  'docs/KNOWN_LIMITATIONS.md',
  'docs/MIGRATING-0.5.0.md',
  'docs/MIGRATING-0.7.0.md',
  'docs/COMPATIBILITY.md',
  'docs/GROK.md',
  'docs/RELEASING.md',
  'docs/SKILLS_ONLY.md',
  'docs/UPSTREAM.md',
  'scripts/validate.mjs',
  'scripts/package.mjs',
  'scripts/doctor.mjs',
  'scripts/docs-hygiene.mjs',
  'scripts/verify.mjs',
  'scripts/archive-safety.mjs',
  'scripts/secret-scan.mjs',
  'scripts/installed-package-smoke.mjs',
  'scripts/host-smoke.mjs',
  'scripts/review-package.mjs',
  'scripts/review-lifecycle.mjs',
  'scripts/assurance-accounting.mjs',
  'scripts/semantic-assurance.mjs',
  'scripts/capability-cache.mjs',
  'scripts/run-postmortem.mjs',
  'scripts/evaluate-execution-economy.mjs',
  'scripts/sync-codex-plugin.mjs',
  'scripts/validate-codex.mjs',
  'scripts/change-snapshot.mjs',
  'scripts/evidence.mjs',
  'scripts/run-budget.mjs',
  'scripts/phase-checkpoint.mjs',
  'scripts/run-control.mjs',
  'scripts/accounting-reconcile.mjs',
  'scripts/coherence-preflight.mjs',
  'scripts/dispatch-record.mjs',
  'scripts/delegation-record.mjs',
  'scripts/model-routing.mjs',
  'scripts/adapter-config.mjs',
  'scripts/convergence.mjs',
  'scripts/init-run.mjs',
  'scripts/context-index.mjs',
  'scripts/plan-conformance.mjs',
  'scripts/release-evidence.mjs',
  'scripts/benchmark-codex.mjs',
  'scripts/lib/execution-budget.mjs',
  'scripts/lib/zip-reader.mjs',
  'scripts/lib/tar-reader.mjs',
  'scripts/lib/runtime.mjs',
  'scripts/lib/run-state.mjs',
  'scripts/lib/run-control.mjs',
  'scripts/lib/run-summary.mjs',
  'scripts/lib/governed-execution.mjs',
  'scripts/lib/coherence-preflight.mjs',
  'scripts/lib/control-plane-mutation.mjs',
  'scripts/lib/semantic-assurance.mjs',
  'scripts/lib/review-lifecycle.mjs',
  'scripts/lib/evidence-validity.mjs',
  'scripts/lib/config-layers.mjs',
  'scripts/lib/model-routing.mjs',
  'scripts/lib/convergence.mjs',
  'scripts/check-version.mjs',
  'scripts/checksums.mjs',
  'scripts/bump-version.mjs',
  'schemas/evidence.schema.json',
  'schemas/dispatch.schema.json',
  'schemas/delegation-decision.schema.json',
  'schemas/model-proposal.schema.json',
  'schemas/zimster-config.schema.json',
  'schemas/routing-observation.schema.json',
  'schemas/convergence-decision.schema.json',
  'schemas/binding-requirements.schema.json',
  'schemas/requirement-matrix.schema.json',
  'schemas/semantic-review.schema.json',
  'schemas/review-records.schema.json',
  'schemas/review-lifecycle.schema.json',
  'schemas/assurance-accounting.schema.json',
  'schemas/completion-decision.schema.json',
  'schemas/context-index.schema.json',
  'schemas/work-journal.schema.json',
  'schemas/run-state.schema.json',
  'schemas/recovery-checkpoint.schema.json',
  'schemas/governed-execution.schema.json',
  'schemas/accounting-reconciliation.schema.json',
  'schemas/coherence-preflight.schema.json',
  'schemas/control-plane-transaction.schema.json',
  'schemas/release-evidence.schema.json',
  'schemas/benchmark-result.schema.json',
  'schemas/benchmark-campaign-result.schema.json',
  'benchmarks/lock/deepswe-v1.1.json',
  'benchmarks/manifests/codex-pro-pilot.json',
  'benchmarks/results/codex-pro-pilot-minimum.json',
  'release/baselines/v0.6.0.json',
  'templates/binding-requirements.json',
  'templates/requirement-matrix.json',
  'templates/zimster-config.json',
  'templates/delegation-decision.json',
  'templates/model-proposal.json',
  'templates/context-index.json',
  'config/model-routing.json',
  'config/standards-lock.json',
  'config/pi-delegation.json',
  'config/convergence.json',
  'config/host-smoke.json',
  'plugins/zimster/.codex-plugin/plugin.json'
];

test('ships the public plugin structure', async () => {
  for (const file of requiredFiles) {
    assert.equal(await exists(file), true, `missing ${file}`);
  }
});

test('release tree excludes obsolete planning and research scratchpads', async () => {
  for (const file of [
    'docs/RESEARCH.md',
    'docs/Zimster-v0.1-Design-Blueprint.md',
    'docs/evaluations/v0.3.0-hardening-postmortem.md',
    'docs/plans/2026-08-04-zimster-v0.6.0.md',
    'docs/zimster/plans/2026-07-27-zimster-v0.1.md'
  ]) assert.equal(await exists(file), false, `obsolete release-tree material remains: ${file}`);
});

test('all primary manifests agree on name and version', async () => {
  const packageJson = await json('package.json');
  for (const manifestPath of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.kimi-plugin/plugin.json'
  ]) {
    const manifest = await json(manifestPath);
    assert.equal(manifest.name, 'zimster', `${manifestPath} name`);
    assert.equal(manifest.version, packageJson.version, `${manifestPath} version`);
    assert.equal(manifest.license, 'MIT', `${manifestPath} license`);
  }
});

test('semantic assurance is exposed as a dependency-free project command', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.scripts.assurance, 'node scripts/semantic-assurance.mjs');
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.scripts['run:control'], 'node scripts/run-control.mjs');
  assert.equal(packageJson.scripts['run:refresh'], 'node scripts/run-control.mjs refresh');
  assert.equal(packageJson.scripts['run:check'], 'node scripts/run-control.mjs check');
});


test('every Codex skill ships OpenAI interface metadata', async () => {
  const { readdir } = await import('node:fs/promises');
  const { read } = await import('./helpers.mjs');
  const entries = await readdir('skills', { withFileTypes: true });
  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  for (const skillName of skillNames) {
    const relative = `skills/${skillName}/agents/openai.yaml`;
    assert.equal(await exists(relative), true, `missing ${relative}`);
    const metadata = await read(relative);
    assert.match(metadata, /^interface:\n/m, `${relative} interface`);
    assert.match(metadata, /default_prompt:.*\$[a-z0-9-]+/m, `${relative} default_prompt`);
  }
});

test('SessionStart uses the portable Node hook without a shell wrapper', async () => {
  assert.equal(await exists('hooks/session-start.mjs'), true);
  assert.equal(await exists('hooks/run-hook.cmd'), false);
  assert.equal(await exists('hooks/session-start'), false);
});
