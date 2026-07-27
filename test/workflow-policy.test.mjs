import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';

test('TDD preserves the red-green-refactor proof discipline', async () => {
  const tdd = await read('skills/test-driven-development/SKILL.md');
  assert.match(tdd, /RED[\s\S]*GREEN[\s\S]*REFACTOR/);
  assert.match(tdd, /NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST/);
  assert.match(tdd, /expected reason/i);
  assert.match(tdd, /mutation|revert/i);
});

test('development is owner-driven and delegation is bounded', async () => {
  const skill = await read('skills/owner-driven-development/SKILL.md');
  assert.match(skill, /persistent implementation owner/i);
  assert.match(skill, /vertical slice/i);
  assert.match(skill, /maximum of two parallel implementation agents/i);
  assert.match(skill, /subagents must not spawn subagents/i);
  assert.match(skill, /one consolidated correction wave/i);
  assert.doesNotMatch(skill, /fresh implementer per task/i);
});

test('reviews are selected by risk and converge by construction', async () => {
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  assert.match(review, /review lenses/i);
  assert.match(review, /architectural seam/i);
  assert.match(review, /one resumed recheck/i);
  assert.match(review, /do not create one reviewer per lens/i);
  assert.match(review, /circuit breaker/i);
});

test('planning preserves semantic detail without microtask multiplication', async () => {
  const plan = await read('skills/writing-plans/SKILL.md');
  assert.match(plan, /proof obligation/i);
  assert.match(plan, /vertical slices/i);
  assert.match(plan, /procedural repetition/i);
  assert.match(plan, /risk trigger/i);
  assert.doesNotMatch(plan, /Each step is one action \(2-5 minutes\)/);
});

test('completion claims require fresh evidence and distinguish unavailable proof', async () => {
  const verification = await read('skills/verification-before-completion/SKILL.md');
  assert.match(verification, /NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE/);
  assert.match(verification, /blocked by environment/i);
  assert.match(verification, /hardware|external service/i);
});
