import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedReviewDirectoryCollision,
  normalizeGitFileMode
} from '../scripts/lib/review-package-files.mjs';
import { npmExecutable } from '../scripts/lib/platform.mjs';

test('Windows untracked mode 100666 normalizes without losing executable semantics', () => {
  assert.equal(normalizeGitFileMode(0o100666), 0o100644);
  assert.equal(normalizeGitFileMode(0o100777), 0o100755);
  assert.equal(normalizeGitFileMode(0o100755), 0o100755);
});

test('Windows EPERM is an expected review-directory collision only for an existing directory', async () => {
  const eperm = Object.assign(new Error('access denied'), { code: 'EPERM' });
  assert.equal(await expectedReviewDirectoryCollision(eperm, 'review-dir', async () => ({
    isDirectory: () => true
  })), true);
  assert.equal(await expectedReviewDirectoryCollision(eperm, 'review-file', async () => ({
    isDirectory: () => false
  })), false);
  assert.equal(await expectedReviewDirectoryCollision(
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
    'review-dir',
    async () => ({ isDirectory: () => true })
  ), false);
});

test('npm executable resolution uses npm.cmd on Windows', () => {
  assert.equal(npmExecutable('win32'), 'npm.cmd');
  assert.equal(npmExecutable('linux'), 'npm');
  assert.equal(npmExecutable('darwin'), 'npm');
});
