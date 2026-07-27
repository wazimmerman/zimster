import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';

test('documents reused Superpowers code and preserves its MIT notice', async () => {
  const notices = await read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Superpowers/i);
  assert.match(notices, /Copyright \(c\) 2025 Jesse Vincent/);
  assert.match(notices, /MIT License/);
  const upstream = await read('docs/UPSTREAM.md');
  assert.match(upstream, /v6\.2\.0/);
  assert.match(upstream, /hooks\/run-hook\.cmd/);
  assert.match(upstream, /adapted/i);
});
