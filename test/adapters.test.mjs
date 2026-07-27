import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { json, read, root } from './helpers.mjs';

test('Claude and Cursor hooks use the cross-platform wrapper', async () => {
  const claude = await json('hooks/hooks.json');
  const command = claude.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /run-hook\.cmd/);
  const cursor = await json('hooks/hooks-cursor.json');
  assert.match(cursor.hooks.sessionStart[0].command, /run-hook\.cmd/);
});

test('session bootstrap injects using-zimster, not the full library', async () => {
  const script = await read('hooks/session-start');
  assert.match(script, /skills\/using-zimster\/SKILL\.md/);
  assert.doesNotMatch(script, /cat .*skills\/.*\/SKILL\.md.*skills\//);
});

test('OpenCode adapter registers skills and injects the bootstrap once', async () => {
  const module = await import(`${pathToFileURL(path.join(root, '.opencode/plugins/zimster.js')).href}?test=${Date.now()}`);
  assert.equal(typeof module.ZimsterPlugin, 'function');

  const plugin = await module.ZimsterPlugin({});
  const config = {};
  await plugin.config(config);
  assert.equal(config.skills.paths.length, 1);
  assert.match(config.skills.paths[0], /skills$/);

  const output = {
    messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }]
  };
  await plugin['experimental.chat.messages.transform']({}, output);
  await plugin['experimental.chat.messages.transform']({}, output);
  const injected = output.messages[0].parts.filter((part) => part.type === 'text' && part.text.includes('zimster:using-zimster bootstrap'));
  assert.equal(injected.length, 1);
});
