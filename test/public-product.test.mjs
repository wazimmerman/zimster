import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { directories, json, read, root } from './helpers.mjs';

const hero = 'One development workflow for coding agents, without the agent sprawl.';
const shortDescription = 'A software development workflow for coding agents.';
const longDescription = 'Build, debug, refactor, review, and ship software with adaptive planning, test-driven development, selective delegation, and evidence-backed verification.';
const starterPrompts = [
  'I have an idea for something new. Help me figure out what to build and get started.',
  'Help me add or change something in this project.',
  "Something isn't working. Help me find the cause and fix it."
];

test('public manifests use the canonical Zimster identity and positioning', async () => {
  const pkg = await json('package.json');
  const portable = await json('plugin.json');
  const codex = await json('.codex-plugin/plugin.json');
  const claude = await json('.claude-plugin/plugin.json');
  const claudeMarketplace = await json('.claude-plugin/marketplace.json');
  const kimi = await json('.kimi-plugin/plugin.json');

  for (const value of [pkg.description, portable.description, codex.description, claude.description, kimi.description]) {
    assert.equal(value, shortDescription);
  }
  for (const value of [portable.author.name, codex.author.name, claude.author.name, kimi.author.name]) {
    assert.equal(value, 'William Zimmerman');
  }
  assert.equal(claudeMarketplace.owner.name, 'William Zimmerman');
  assert.equal(claudeMarketplace.plugins[0].author.name, 'William Zimmerman');
  assert.equal(claudeMarketplace.description, shortDescription);
  assert.equal(claudeMarketplace.plugins[0].description, longDescription);

  assert.equal(codex.interface.shortDescription, 'Workflow for coding agents');
  assert.equal(codex.interface.longDescription, longDescription);
  assert.equal(codex.interface.developerName, 'William Zimmerman');
  assert.equal(kimi.interface.shortDescription, shortDescription);
  assert.equal(kimi.interface.longDescription, longDescription);
  assert.equal(kimi.interface.developerName, 'William Zimmerman');
});

test('Codex exposes exactly the three supported starter prompts within its schema limit', async () => {
  const codex = await json('.codex-plugin/plugin.json');
  assert.deepEqual(codex.interface.defaultPrompt, starterPrompts);
  assert.equal(codex.interface.defaultPrompt.length, 3);
  assert.equal(codex.interface.defaultPrompt.every((prompt) => prompt.length <= 128), true);
});

test('the MIT license uses William Zimmerman without disturbing third-party attribution', async () => {
  assert.match(await read('LICENSE'), /^Copyright \(c\) 2026 William Zimmerman$/m);
  assert.match(await read('THIRD_PARTY_NOTICES.md'), /Copyright \(c\) 2025 Jesse Vincent/);
});

test('README leads with plain positioning, normal usage, and implemented feature groups', async () => {
  const readme = await read('README.md');
  assert.match(readme, new RegExp(hero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /^## How to use Zimster$/m);
  assert.match(readme, /describe\s+the software work|tell your coding agent what/i);
  assert.match(readme, /smallest\s+appropriate workflow/i);
  for (const example of ['new project', 'add or change', 'debug', 'refactor', 'review', 'architecture']) {
    assert.match(readme, new RegExp(example, 'i'));
  }
  for (const heading of [
    'Design, specifications, and planning',
    'Implementation and debugging',
    'Review and verification',
    'Delegation and model use',
    'Continuity and bounded automation',
    'Portability'
  ]) assert.match(readme, new RegExp(`^### ${heading}$`, 'm'));
  assert.match(readme, /risk-adaptive form of spec-driven development/i);
  assert.match(readme, /requirements.*specification[\s\S]*architecture.*design[\s\S]*TDD[\s\S]*review.*integration[\s\S]*requirement.*completion/i);
  assert.match(readme, /specification.*TDD.*complement|complement.*specification.*TDD/is);
  assert.doesNotMatch(readme, /implements GitHub Spec Kit|replaces every (?:coding )?plugin/i);
});

test('roadmap restores semantic assurance, evidence sufficiency, and optional future visual work', async () => {
  const roadmap = await read('docs/ROADMAP.md');
  assert.match(roadmap, /^## 0\.8: Semantic assurance and evidence sufficiency$/m);
  for (const phrase of [
    'fail closed', 'literal', 'interpolated', 'computed', 'dynamic',
    'stable semantic graph identity', 'material ambiguity', 'adversarial equivalence',
    'shared-domain authority', 'assurance-report deduplication'
  ]) assert.match(roadmap, new RegExp(phrase.replaceAll(' ', '\\s+'), 'i'));
  for (const phrase of [
    'intended claim', 'required evidence', 'evidence adequacy',
    'required coverage or sample', 'projected time, token, and cash cost',
    'execute, redesign the evidence, or narrow the claim'
  ]) assert.match(roadmap, new RegExp(phrase.replaceAll(' ', '\\s+'), 'i'));
  assert.match(roadmap, /greater task diversity|more unique tasks/i);
  assert.match(roadmap, /fewer repeats/i);
  assert.match(roadmap, /Superpowers.*GSD|GSD.*Superpowers/i);
  assert.match(roadmap, /null|negative/i);
  assert.match(roadmap, /^## 0\.9: Optional visual design companion$/m);
  assert.match(roadmap, /optional/i);
  assert.match(roadmap, /annotated screenshots|side-by-side/i);
  assert.match(roadmap, /persistent (?:browser|service)|heavyweight persistent infrastructure/i);
});

test('evaluation keeps the pilot historical to 95dfedf and excludes it from final-candidate claims', async () => {
  const evaluation = await read('docs/EVALUATION.md');
  assert.match(evaluation, /95dfedf7d396a7b9faa72ced844a28f70bd6bcef/);
  assert.match(evaluation, /historical/i);
  assert.match(evaluation, /12 complete pairs[\s\S]*24\s+scored runs/i);
  assert.match(evaluation, /83\.33%[\s\S]*75%[\s\S]*\+8\.33 percentage points/i);
  assert.match(evaluation, /95%\s+confidence\s+interval of 0 to 25 percentage points/i);
  assert.match(evaluation, /no statistically significant[\s\S]*adjusted secondary/i);
  assert.match(evaluation, /do not apply to or describe the final v0\.7 candidate/i);
  assert.match(evaluation, /historical evidence[\s\S]*not final-candidate\s+evidence/i);
  assert.match(evaluation, /no comparative benchmark[\s\S]*final v0\.7|final v0\.7[\s\S]*no comparative benchmark/i);
  assert.match(evaluation, /evidence[- ]sufficiency|cost planning/i);
});

test('the public skill inventory comes from the twelve canonical metadata entries', async () => {
  const names = await directories('skills');
  assert.equal(names.length, 12);
  for (const name of names) {
    assert.match(await read(`skills/${name}/SKILL.md`), new RegExp(`^name: ${name}$`, 'm'));
  }
});

test('documentation hygiene reports em dashes with useful path and line diagnostics', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-docs-hygiene-'));
  try {
    await writeFile(path.join(temporary, 'README.md'), 'first line\nbad — punctuation\n');
    let result = spawnSync(process.execPath, [path.join(root, 'scripts/docs-hygiene.mjs'), '--root', temporary], {
      cwd: root, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /README\.md:2: em dash/i);

    await writeFile(path.join(temporary, 'README.md'), 'first line\ngood punctuation\n');
    result = spawnSync(process.execPath, [path.join(root, 'scripts/docs-hygiene.mjs'), '--root', temporary], {
      cwd: root, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('canonical check runs the public documentation hygiene gate', async () => {
  const pkg = await json('package.json');
  assert.equal(pkg.scripts['docs:hygiene'], 'node scripts/docs-hygiene.mjs');
  assert.match(pkg.scripts.check, /npm run docs:hygiene/);
});
