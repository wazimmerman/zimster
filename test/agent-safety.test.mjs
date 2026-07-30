import test from 'node:test';
import assert from 'node:assert/strict';
import { exists, read } from './helpers.mjs';

for (const role of ['scout', 'integration-reviewer']) {
  test(`${role} is a pure read-only role without unrestricted Bash`, async () => {
    const content = await read(`agents/${role}.md`);
    const tools = content.match(/^tools:\s*(.+)$/m)?.[1] ?? '';
    assert.doesNotMatch(tools, /\bBash\b/);
    assert.match(content, /read-only/i);
  });
}

test('test-capable reviewer has explicit tree-integrity controls', async () => {
  assert.equal(await exists('agents/test-reviewer.md'), true);
  const content = await read('agents/test-reviewer.md');
  assert.match(content, /Bash/);
  assert.match(content, /before.*after.*tree|tree.*integrity|working-tree fingerprint/is);
  assert.match(content, /must not modify|read-only/i);
  assert.match(content, /review-integrity\.mjs.*capture/is);
  assert.match(content, /review-integrity\.mjs.*verify/is);
  assert.match(content, /immutable.*base.*head|base.*head.*immutable/is);
  assert.match(content, /--review-files/);
  assert.match(content, /REVIEW_CHECKOUT_CHANGED/);
  assert.doesNotMatch(content, /TREE_INTEGRITY_(?:OK|VIOLATION)/);
});

test('integration reviewer falsifies claims and separates semantic and checkout verdicts', async () => {
  const content = await read('agents/integration-reviewer.md');
  assert.match(content, /falsif/i);
  assert.match(content, /SEMANTIC_REVIEW_APPROVED/);
  assert.match(content, /NEEDS_CORRECTION/);
  assert.match(content, /BLOCKED_BY_MISSING_EVIDENCE/);
  assert.match(content, /SELF_REVIEW_ONLY/);
  assert.match(content, /REVIEW_CHECKOUT_(?:UNCHANGED|CHANGED|UNVERIFIED)/);
  assert.match(content, /unverified obligations/i);
});

test('model routing is explicit and auditable', async () => {
  const routing = JSON.parse(await read('config/model-routing.json'));
  assert.deepEqual(Object.keys(routing.tiers), ['fast', 'standard', 'expert']);
  for (const role of ['scout', 'integration-reviewer', 'test-reviewer', 'diagnostician']) {
    assert.ok(routing.roles[role], `missing routing for ${role}`);
  }
  const owner = await read('skills/owner-driven-development/SKILL.md');
  assert.match(owner, /requested model.*effective model|effective model.*requested model/is);
  assert.match(owner, /dispatch record/i);
});
