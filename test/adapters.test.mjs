import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { exists, json, read, root } from './helpers.mjs';

test('Claude hook uses the cross-platform wrapper', async () => {
  const claude = await json('hooks/hooks.json');
  const command = claude.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /run-hook\.cmd/);
});

test('Cursor uses documented project skills and command surfaces only', async () => {
  assert.equal(await exists('.cursor-plugin/plugin.json'), false, 'obsolete Cursor manifest must not ship');
  assert.equal(await exists('hooks/hooks-cursor.json'), false, 'unsupported Cursor lifecycle hook must not ship');
  const command = await read('.cursor/commands/using-zimster.md');
  assert.match(command, /using-zimster/);
  assert.match(command, /sync-skills/);
  const pkg = await json('package.json');
  assert.ok(pkg.files.includes('.cursor'));
  assert.ok(!pkg.files.includes('.cursor-plugin'));
});

test('Kimi manifest contains only documented fields and one native bootstrap', async () => {
  const manifest = await json('.kimi-plugin/plugin.json');
  const allowed = new Set([
    'name', 'version', 'description', 'keywords', 'author', 'homepage', 'license',
    'interface', 'skills', 'sessionStart', 'skillInstructions', 'mcpServers',
    'hooks', 'commands'
  ]);
  assert.deepEqual(Object.keys(manifest).filter((key) => !allowed.has(key)), []);
  assert.deepEqual(Object.keys(manifest.interface).sort(), [
    'developerName', 'displayName', 'longDescription', 'shortDescription', 'websiteURL'
  ]);
  assert.deepEqual(manifest.sessionStart, { skill: 'using-zimster' });
  assert.equal(manifest.skills, './skills/');
});

test('session bootstrap injects using-zimster, not the full library', async () => {
  const script = await read('hooks/session-start');
  assert.match(script, /skills\/using-zimster\/SKILL\.md/);
  assert.doesNotMatch(script, /cat .*skills\/.*\/SKILL\.md.*skills\//);
});

test('OpenCode adapter registers skills and injects the bootstrap once', async () => {
  const module = await import(`${pathToFileURL(path.join(root, '.opencode/plugins/zimster.js')).href}?test=${Date.now()}`);
  assert.equal(typeof module.ZimsterPlugin, 'function');
  assert.throws(
    () => module.assertZimsterPackage(path.join(root, 'missing-opencode-package')),
    /ZIMSTER_PACKAGE_INVALID.*using-zimster/
  );

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

test('Pi package declares its adapter and the adapter injects once', async () => {
  const pkg = await json('package.json');
  assert.deepEqual(pkg.pi.extensions, ['./.pi/extensions/zimster.ts']);
  assert.deepEqual(pkg.pi.skills, ['./skills']);

  const module = await import(`${pathToFileURL(path.join(root, '.pi/extensions/zimster.ts')).href}?test=${Date.now()}`);
  assert.throws(
    () => module.loadZimsterBootstrap(path.join(root, 'missing-pi-skill.md')),
    /ZIMSTER_PACKAGE_INVALID.*using-zimster/
  );
  const handlers = new Map();
  module.default({ on: (name, handler) => handlers.set(name, handler) });
  assert.deepEqual(await handlers.get('resources_discover')(), {
    skillPaths: [path.join(root, 'skills')]
  });
  await handlers.get('session_start')();
  const original = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
  const once = await handlers.get('context')({ messages: original });
  const twice = await handlers.get('context')({ messages: once.messages });
  const messages = twice?.messages ?? once.messages;
  const text = JSON.stringify(messages);
  assert.equal(text.match(/zimster:using-zimster bootstrap for pi/g)?.length, 1);
});

test('secondary adapter validator accepts the documented package', async () => {
  const { validateSecondaryAdapters } = await import('../scripts/validate-adapters.mjs');
  assert.deepEqual(await validateSecondaryAdapters(root), []);
});

test('each secondary harness has lifecycle and diagnostic instructions', async () => {
  for (const harness of ['CURSOR', 'KIMI', 'OPENCODE', 'PI']) {
    const guide = await read(`docs/${harness}.md`);
    for (const heading of ['Install', 'Update', 'Remove', 'Diagnostics', 'Verification status']) {
      assert.match(guide, new RegExp(`^## ${heading}$`, 'm'), `${harness} missing ${heading}`);
    }
  }
});
