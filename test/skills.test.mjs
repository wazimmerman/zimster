import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { directories, read, root } from './helpers.mjs';
import { readFile } from 'node:fs/promises';

const requiredSkills = [
  'designing-work',
  'dispatching-parallel-agents',
  'finishing-a-development-branch',
  'owner-driven-development',
  'receiving-code-review',
  'risk-adaptive-review',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-zimster',
  'verification-before-completion',
  'writing-plans'
].sort();

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'missing YAML frontmatter');
  const values = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

test('ships the intentional compact skill set', async () => {
  assert.deepEqual(await directories('skills'), requiredSkills);
});

test('every skill has valid frontmatter and a bounded size', async () => {
  for (const name of requiredSkills) {
    const content = await readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const frontmatter = parseFrontmatter(content);
    assert.equal(frontmatter.name, name);
    assert.ok(frontmatter.description?.length >= 20, `${name} description is too short`);
    const lines = content.split('\n').length;
    assert.ok(lines <= 240, `${name} is ${lines} lines; compact skills must stay <= 240`);
  }
});

test('bootstrap is selective rather than forcing every skill on every task', async () => {
  const content = await read('skills/using-zimster/SKILL.md');
  assert.match(content, /select the smallest workflow/i);
  assert.match(content, /do not load every skill/i);
  assert.doesNotMatch(content, /1% chance/i);
});
