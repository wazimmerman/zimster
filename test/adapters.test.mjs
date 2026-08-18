import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { exists, json, read, root } from './helpers.mjs';

test('Claude hook uses a dependency-free Node exec without forcing Bash', async () => {
  const claude = await json('hooks/hooks.json');
  const hook = claude.hooks.SessionStart[0].hooks[0];
  assert.equal(hook.command, 'node');
  assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs']);
  assert.equal(hook.shell, undefined);
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
  const script = await read('hooks/session-start.mjs');
  assert.match(script, /'skills', 'using-zimster', 'SKILL\.md'/);
  assert.doesNotMatch(script, /readdir|glob/i);
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

test('Pi package declares one skill-loading surface and the adapter injects once', async () => {
  const pkg = await json('package.json');
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.deepEqual(pkg.pi.extensions, ['./.pi/extensions/zimster.ts']);
  assert.deepEqual(pkg.pi.skills, ['./skills']);
  assert.equal(pkg.pi.image, './assets/zimster-plugin-icon.png');
  assert.equal(pkg.homepage, 'https://zimster.dev');
  assert.ok(!pkg.files.includes('plugins'));

  const module = await import(`${pathToFileURL(path.join(root, '.pi/extensions/zimster.ts')).href}?test=${Date.now()}`);
  assert.throws(
    () => module.loadZimsterBootstrap(path.join(root, 'missing-pi-skill.md')),
    /ZIMSTER_PACKAGE_INVALID.*using-zimster/
  );
  const handlers = new Map();
  module.default({ on: (name, handler) => handlers.set(name, handler) });
  assert.equal(handlers.has('resources_discover'), false);
  await handlers.get('session_start')();
  const original = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
  const once = await handlers.get('context')({ messages: original });
  const twice = await handlers.get('context')({ messages: once.messages });
  const messages = twice?.messages ?? once.messages;
  const text = JSON.stringify(messages);
  assert.equal(text.match(/zimster:using-zimster bootstrap for pi/g)?.length, 1);
});

test('Pi optional delegation uses a pinned, depth-zero capability boundary with inline fallback', async () => {
  const contract = await json('config/pi-delegation.json');
  assert.equal(contract.protocol, 'zimster.pi-delegation.v1');
  assert.deepEqual(contract.methods, ['probe', 'launch', 'status', 'cancel', 'collect']);
  assert.equal(contract.transport.package, 'pi-subagents');
  assert.equal(contract.transport.version, '0.42.1');
  assert.equal(contract.max_parallel_implementers, 2);
  assert.equal(contract.max_subagent_depth, 0);
  assert.equal(contract.integration_owner, 'root');

  const module = await import(`${pathToFileURL(path.join(root, '.pi/delegation.ts')).href}?test=${Date.now()}`);
  const capability = module.createPiDelegationCapability();
  assert.deepEqual(await capability.probe(), {
    available: false,
    protocol: 'zimster.pi-delegation.v1',
    reason: 'optional_transport_unavailable'
  });
  assert.equal((await capability.launch({ role: 'scout', depth: 0 })).status, 'inline_required');
  await assert.rejects(capability.launch({ role: 'scout', depth: 1 }), /depth/i);
});

test('Pi delegation keeps two independent launches parallel and nested work fail-closed', async () => {
  const module = await import(`${pathToFileURL(path.join(root, '.pi/delegation.ts')).href}?parallel=${Date.now()}`);
  let inFlight = 0;
  let peak = 0;
  const requests = [];
  const transport = Object.fromEntries(['probe', 'status', 'cancel', 'collect'].map((name) => [
    name, async (request) => ({ name, request })
  ]));
  transport.launch = async (request) => {
    requests.push(request);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    return { status: 'launched', id: request.id };
  };
  const capability = module.createPiDelegationCapability(transport);
  const [first, second] = await Promise.all([
    capability.launch({ id: 'impl-a', role: 'bounded_implementer', depth: 0 }),
    capability.launch({ id: 'impl-b', role: 'bounded_implementer', depth: 0 })
  ]);
  assert.equal(peak, 2);
  assert.deepEqual([first.id, second.id], ['impl-a', 'impl-b']);
  assert.equal(requests.every((request) =>
    request.maxParallelImplementers === 2 && request.allowNestedSubagents === false
  ), true);
  await assert.rejects(
    capability.launch({ id: 'nested', role: 'bounded_implementer', depth: 1 }),
    /depth/i
  );
  assert.equal(requests.length, 2, 'nested launch must not reach the transport');
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

test('ROUTE-005: harness capability reports distinguish routing enforcement and effective reporting', async () => {
  const matrix = await json('config/harness-capabilities.json');
  for (const harness of ['codex', 'claude', 'grok', 'cursor', 'kimi', 'opencode', 'pi']) {
    const capabilities = matrix.harnesses[harness].capabilities;
    assert.ok(capabilities.model_routing_enforcement, `${harness} missing routing enforcement capability`);
    assert.ok(capabilities.effective_model_reporting, `${harness} missing effective-model reporting capability`);
  }
  assert.equal(matrix.harnesses.pi.capabilities.model_routing_enforcement, 'unavailable');
  assert.equal(matrix.harnesses.pi.capabilities.delegated_runtime, 'unavailable');
});

test('adapter generator writes only explicit owned outputs and removes only matching generated files', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-adapters-'));
  try {
    const config = path.join(temporary, 'config.json');
    const capabilities = path.join(temporary, 'capabilities.json');
    await writeFile(capabilities, JSON.stringify({
      per_agent_model_selection: 'native',
      model_routing_enforcement: 'native',
      effective_model_reporting: 'supported_with_constraints'
    }));
    await writeFile(config, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'balanced', strict_cost: false,
        role_classes: { 'integration-reviewer': 'expert' },
        mappings: { expert: [{
          model: 'user/expert-model', effort: 'high',
          availability: 'declared_available', availability_source: 'user configuration'
        }] }
      }
    }));
    const script = path.join(root, 'scripts/adapter-config.mjs');
    for (const [harness, expected] of [
      ['codex', /model\s*=\s*"user\/expert-model"/],
      ['claude', /model:\s*"user\/expert-model"/],
      ['cursor', /model:\s*"user\/expert-model"/],
      ['opencode', /model:\s*"user\/expert-model"/]
    ]) {
      const output = path.join(temporary, harness);
      let result = spawnSync(process.execPath, [
        script, 'generate', '--harness', harness, '--scope', 'project',
        '--config', config, '--output', output, '--capabilities', capabilities
      ], { cwd: temporary, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const manifestPath = result.stdout.trim();
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(manifest.owner, 'zimster');
      assert.equal(manifest.harness, harness);
      assert.equal(manifest.files.length, 1);
      assert.match(await readFile(path.join(output, manifest.files[0].path), 'utf8'), expected);

      result = spawnSync(process.execPath, [script, 'remove', '--manifest', manifestPath], {
        cwd: temporary, encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      await assert.rejects(readFile(manifestPath, 'utf8'), /ENOENT/);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('ROUTE-003: recommend mode cannot generate concrete adapter model overrides', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-adapter-recommend-'));
  try {
    const config = path.join(temporary, 'config.json');
    const capabilities = path.join(temporary, 'capabilities.json');
    await writeFile(capabilities, JSON.stringify({ per_agent_model_selection: 'native' }));
    await writeFile(config, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'recommend', policy: 'balanced',
        role_classes: { reviewer: 'expert' },
        mappings: { expert: [{
          model: 'advisory-only', effort: 'high',
          availability: 'declared_available', availability_source: 'test'
        }] }
      }
    }));
    const result = spawnSync(process.execPath, [
      path.join(root, 'scripts/adapter-config.mjs'), 'generate',
      '--harness', 'codex', '--scope', 'project', '--config', config,
      '--output', path.join(temporary, 'output'), '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /recommend.*inherit|advisory.*override/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('adapter generator keeps provider identity separate except for OpenCode provider/model syntax', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-adapter-provider-'));
  try {
    const config = path.join(temporary, 'config.json');
    const capabilities = path.join(temporary, 'capabilities.json');
    await writeFile(capabilities, JSON.stringify({ per_agent_model_selection: 'native' }));
    await writeFile(config, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'balanced',
        role_classes: { reviewer: 'expert' },
        mappings: { expert: [{
          provider: 'provider-a', model: 'expert-model', effort: 'high',
          availability: 'declared_available', availability_source: 'user configuration'
        }] }
      }
    }));
    const script = path.join(root, 'scripts/adapter-config.mjs');
    for (const [harness, expected, forbidden] of [
      ['codex', /model\s*=\s*"expert-model"/, /provider-a\/expert-model/],
      ['claude', /model:\s*"expert-model"/, /provider-a\/expert-model/],
      ['opencode', /model:\s*"provider-a\/expert-model"/, /model:\s*"expert-model"/]
    ]) {
      const output = path.join(temporary, harness);
      const result = spawnSync(process.execPath, [
        script, 'generate', '--harness', harness, '--scope', 'project',
        '--config', config, '--output', output, '--capabilities', capabilities
      ], { cwd: temporary, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const manifest = JSON.parse(await readFile(result.stdout.trim(), 'utf8'));
      const generated = await readFile(path.join(output, manifest.files[0].path), 'utf8');
      assert.match(generated, expected);
      assert.doesNotMatch(generated, forbidden);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('adapter generator refuses user-owned collisions and symlink targets', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-adapter-collision-'));
  try {
    const config = path.join(temporary, 'config.json');
    const capabilities = path.join(temporary, 'capabilities.json');
    await writeFile(capabilities, JSON.stringify({ per_agent_model_selection: 'native' }));
    await writeFile(config, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'balanced',
        role_classes: { 'integration-reviewer': 'expert' },
        mappings: { expert: [{
          model: 'user/expert-model', effort: 'high',
          availability: 'declared_available', availability_source: 'user configuration'
        }] }
      }
    }));
    const script = path.join(root, 'scripts/adapter-config.mjs');
    const collision = path.join(temporary, 'collision');
    await mkdir(collision, { recursive: true });
    await writeFile(path.join(collision, 'integration-reviewer.md'), 'user owned\n');
    let result = spawnSync(process.execPath, [
      script, 'generate', '--harness', 'claude', '--scope', 'project',
      '--config', config, '--output', collision, '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /collision|owned/i);

    const symlinkOutput = path.join(temporary, 'symlink');
    await mkdir(symlinkOutput, { recursive: true });
    await symlink(path.join(temporary, 'outside.md'), path.join(symlinkOutput, 'integration-reviewer.md'));
    result = spawnSync(process.execPath, [
      script, 'generate', '--harness', 'claude', '--scope', 'project',
      '--config', config, '--output', symlinkOutput, '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|collision|owned/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('adapter generation rejects path/frontmatter injection and modified generated files', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zimster-adapter-safety-'));
  try {
    const script = path.join(root, 'scripts/adapter-config.mjs');
    const capabilities = path.join(temporary, 'capabilities.json');
    await writeFile(capabilities, JSON.stringify({ per_agent_model_selection: 'native' }));
    const unsafe = path.join(temporary, 'unsafe.json');
    await writeFile(unsafe, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'balanced',
        role_classes: { '../victim': 'expert' },
        mappings: { expert: [{
          model: 'safe-model\npermission: allow', effort: 'high',
          availability: 'declared_available', availability_source: 'test'
        }] }
      }
    }));
    const output = path.join(temporary, 'output');
    let result = spawnSync(process.execPath, [
      script, 'generate', '--harness', 'claude', '--scope', 'project',
      '--config', unsafe, '--output', output, '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /role|safe|newline|path/i);
    await assert.rejects(readFile(path.join(temporary, 'victim.md'), 'utf8'), /ENOENT/);

    const safe = path.join(temporary, 'safe.json');
    await writeFile(safe, JSON.stringify({
      schema_version: 1,
      routing: {
        mode: 'map_only', policy: 'balanced',
        role_classes: { reviewer: 'expert', scout: 'expert' },
        mappings: { expert: [{
          model: 'safe-model', effort: 'high',
          availability: 'declared_available', availability_source: 'test'
        }] }
      }
    }));
    result = spawnSync(process.execPath, [
      script, 'generate', '--harness', 'claude', '--scope', 'project',
      '--config', safe, '--output', output, '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifestPath = result.stdout.trim();
    const generated = path.join(output, 'reviewer.md');
    const original = await readFile(generated, 'utf8');
    await writeFile(generated, `${original}user modification\n`);
    result = spawnSync(process.execPath, [
      script, 'generate', '--harness', 'claude', '--scope', 'project',
      '--config', safe, '--output', output, '--capabilities', capabilities
    ], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changed|digest|modified/i);
    assert.match(await readFile(generated, 'utf8'), /user modification/);

    await writeFile(generated, original);
    const later = path.join(output, 'scout.md');
    await writeFile(later, `${await readFile(later, 'utf8')}later modification\n`);
    result = spawnSync(process.execPath, [script, 'remove', '--manifest', manifestPath], {
      cwd: temporary, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changed since creation/i);
    assert.match(await readFile(generated, 'utf8'), /Generated role override/,
      'preflight failure must not partially delete earlier files');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
