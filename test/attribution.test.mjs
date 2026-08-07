import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';

test('documents reused Superpowers code and preserves its MIT notice', async () => {
  const notices = await read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Superpowers/i);
  assert.match(notices, /Copyright \(c\) 2025 Jesse Vincent/);
  assert.match(notices, /MIT License/);
  assert.doesNotMatch(notices, /docs\/RESEARCH\.md/);
  assert.match(notices, /preserved in Git history/i);
  const upstream = await read('docs/UPSTREAM.md');
  assert.match(upstream, /v6\.2\.0/);
  assert.match(upstream, /hooks\/session-start\.mjs/);
  assert.match(upstream, /adapted/i);
});

test('documents the pinned OpenAI Codex contract port and Apache license', async () => {
  const notices = await read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /OpenAI Codex plugin contract/i);
  assert.match(notices, /Apache License 2\.0/i);
  const source = await read('vendor/openai-codex-plugin-validator/SOURCE.md');
  assert.match(source, /88fae0fd00998ea32fa2393869042f0231a2b43b/);
  const license = await read('vendor/openai-codex-plugin-validator/LICENSE');
  assert.match(license, /Apache License/);
  assert.match(license, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
});
