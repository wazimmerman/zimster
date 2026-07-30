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


test('Git lifecycle defines default-branch, commit, delegated, and no-commit behavior', async () => {
  const owner = await read('skills/owner-driven-development/SKILL.md');
  const finish = await read('skills/finishing-a-development-branch/SKILL.md');
  assert.match(owner, /disposable.*default branch|default branch.*disposable/is);
  assert.match(owner, /verified vertical-slice boundaries/i);
  assert.match(owner, /user says.*do not commit|do not commit.*user/is);
  assert.match(owner, /delegated implementer.*commit|commit.*delegated implementer/is);
  assert.match(finish, /staged.*unstaged.*untracked/is);
  assert.match(finish, /branch.*commits.*staged.*unstaged.*untracked/is);
});

test('review scope explicitly includes all untracked files', async () => {
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  const finish = await read('skills/finishing-a-development-branch/SKILL.md');
  for (const content of [review, finish]) {
    assert.match(content, /git status --short/);
    assert.match(content, /git diff --cached/);
    assert.match(content, /untracked/i);
    assert.match(content, /change-snapshot|add -N|read every untracked/i);
  }
});

test('multi-behavior TDD requires meaningful RED evidence beyond a missing module', async () => {
  const tdd = await read('skills/test-driven-development/SKILL.md');
  assert.match(tdd, /multi-behavior|multiple behaviors/i);
  assert.match(tdd, /module.*not found.*does not prove|does not prove.*module.*not found/is);
  assert.match(tdd, /incremental.*RED|incomplete stub|mutation checks/is);
  assert.match(tdd, /each load-bearing behavior/i);
});

test('verification prefers repository-declared commands and classifies test discovery', async () => {
  const verification = await read('skills/verification-before-completion/SKILL.md');
  assert.match(verification, /package scripts|Makefile|task runner|CI/i);
  assert.match(verification, /canonical|repository-declared/i);
  assert.match(verification, /failed before.*discover|zero tests|tests executed/is);
  assert.match(verification, /baseline.*zero tests|zero tests.*baseline/is);
});

test('Micro Standard and High-risk profiles have deterministic mapping and rationale', async () => {
  const bootstrap = await read('skills/using-zimster/SKILL.md');
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  assert.match(bootstrap, /all dimensions are low|single coherent slice/i);
  assert.match(bootstrap, /any high|hard trigger/i);
  assert.match(bootstrap, /report.*profile.*rationale|profile.*rationale/is);
  assert.match(review, /Micro[\s\S]*Standard[\s\S]*High risk/);
});

test('durable state has deterministic creation triggers', async () => {
  const bootstrap = await read('skills/using-zimster/SKILL.md');
  const owner = await read('skills/owner-driven-development/SKILL.md');
  for (const content of [bootstrap, owner]) {
    assert.match(content, /more than one vertical slice/i);
    assert.match(content, /any subagent/i);
    assert.match(content, /independent review/i);
    assert.match(content, /external or hardware/i);
    assert.match(content, /more than one commit boundary/i);
    assert.match(content, /resum/i);
    assert.doesNotMatch(content, /\.zimster\/run\.md/);
    assert.match(content, /Git-local|git rev-parse --git-path/i);
  }
});

test('bootstrap policy enforces execution economy and phase-bounded ownership', async () => {
  const bootstrap = await read('skills/using-zimster/SKILL.md');
  assert.match(bootstrap, /logical owner[\s\S]*physical context|physical context[\s\S]*logical owner/i);
  assert.match(bootstrap, /phase checkpoint/i);
  assert.match(bootstrap, /execution budget/i);
  assert.match(bootstrap, /goal:verify/);
  assert.match(bootstrap, /valid receipt[\s\S]*before repeating|before repeating[\s\S]*valid receipt/i);
  assert.match(bootstrap, /installed-package smoke[\s\S]*final integration review/i);
  assert.match(bootstrap, /capability cache/i);
  assert.match(bootstrap, /postmortem/i);
});

test('completion states include requirement blockers', async () => {
  const verification = await read('skills/verification-before-completion/SKILL.md');
  const owner = await read('skills/owner-driven-development/SKILL.md');
  assert.match(verification, /BLOCKED_BY_REQUIREMENT/);
  assert.match(owner, /BLOCKED_BY_REQUIREMENT/);
});

test('review types and checkout integrity have non-overlapping assurance meaning', async () => {
  const bootstrap = await read('skills/using-zimster/SKILL.md');
  const owner = await read('skills/owner-driven-development/SKILL.md');
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  for (const content of [bootstrap, owner, review]) {
    assert.match(content, /self_review/);
    assert.match(content, /independent_review/);
    assert.match(content, /owner-inline.*self.review|self.review.*owner-inline/is);
    assert.match(content, /REVIEW_CHECKOUT_UNCHANGED/);
    assert.match(content, /REVIEW_CHECKOUT_CHANGED/);
    assert.match(content, /checkout integrity.*(?:never|does not).*semantic approval|semantic approval.*(?:never|does not).*checkout integrity/is);
    assert.doesNotMatch(content, /TREE_INTEGRITY_(?:OK|VIOLATION)/);
  }
});

test('profile-appropriate semantic approval gates candidate completion', async () => {
  const bootstrap = await read('skills/using-zimster/SKILL.md');
  const owner = await read('skills/owner-driven-development/SKILL.md');
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  const verification = await read('skills/verification-before-completion/SKILL.md');
  assert.match(bootstrap, /Micro.*owner-only.*deterministic|deterministic.*Micro.*owner-only/is);
  for (const content of [bootstrap, owner, review, verification]) {
    assert.match(content, /Standard.*High.risk.*independent_review|independent_review.*Standard.*High.risk/is);
    assert.match(content, /exact.*candidate.*head|candidate.*head.*exact/is);
    assert.match(content, /OWNER_VERIFIED_REVIEW_UNAVAILABLE/);
    assert.match(content, /CANDIDATE_COMPLETE/);
  }
  assert.match(review, /High.risk.*load-bearing.*final.*integration|load-bearing.*High.risk.*final.*integration/is);
});

test('plans and verification bind stable requirement IDs to scoped proof and claims', async () => {
  const plan = await read('skills/writing-plans/SKILL.md');
  const verification = await read('skills/verification-before-completion/SKILL.md');
  for (const content of [plan, verification]) {
    assert.match(content, /stable requirement IDs/i);
    assert.match(content, /requirement-to-evidence matrix/i);
    assert.match(content, /intended acceptance claims/i);
    assert.match(content, /environment|harness/i);
    assert.match(content, /unavailable proof/i);
  }
  assert.match(verification, /narrow evidence.*broad|broad.*narrow evidence/is);
  assert.match(verification, /semantic-assurance\.mjs complete/);
});

test('risk lenses cover framework defaults and shared control flow', async () => {
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  assert.match(review, /framework-defaults-and-conventions/);
  assert.match(review, /build tool|build-tool/i);
  assert.match(review, /wrapper|adapter/i);
  assert.match(review, /configuration loader/i);
  assert.match(review, /CLI framework/i);
  assert.match(review, /router/i);
  assert.match(review, /ORM/);
  assert.match(review, /plugin system/i);
  assert.match(review, /inherited project configuration/i);
  assert.match(review, /generated.*user-managed topology/i);
  assert.match(review, /alternate location/i);
  assert.match(review, /working director/i);
  assert.match(review, /shared-control-flow/);
  assert.match(review, /shared adapter|shared provider/i);
  assert.match(review, /common.*specialized/i);
  assert.match(review, /early[- ]return.*bypass/is);
  assert.match(review, /specialized setup.*order/is);
  assert.match(review, /fallback.*mask/is);
  assert.match(review, /specialized[- ]contract.*suppress/is);
});

test('review packages falsify claims and corrections invalidate affected approval', async () => {
  const review = await read('skills/risk-adaptive-review/SKILL.md');
  const receiving = await read('skills/receiving-code-review/SKILL.md');
  assert.match(review, /semantic review package/i);
  assert.match(review, /binding requirement IDs/i);
  assert.match(review, /attempt.*falsif|falsif.*intended acceptance claims/is);
  assert.match(review, /BLOCKED_BY_MISSING_EVIDENCE/);
  assert.match(receiving, /invalidate.*evidence|evidence.*invalidate/is);
  assert.match(receiving, /invalidate.*approval|approval.*invalidate/is);
  assert.match(receiving, /same reviewer.*one.*recheck|one.*recheck.*same reviewer/is);
});
