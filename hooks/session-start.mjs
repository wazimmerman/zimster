#!/usr/bin/env node
// Adapted from Superpowers v6.2.0 under the MIT License.
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(scriptDirectory, '..');
const skillFile = path.join(pluginRoot, 'skills', 'using-zimster', 'SKILL.md');

let bootstrap;
try {
  bootstrap = await readFile(skillFile, 'utf8');
} catch {
  writeSync(
    process.stderr.fd,
    `zimster SessionStart: cannot read required using-zimster skill at ${skillFile}\n`
  );
  process.exitCode = 2;
}

if (bootstrap !== undefined) {
  const context = [
    '<ZIMSTER_BOOTSTRAP>',
    'zimster:using-zimster bootstrap',
    '',
    bootstrap.trim(),
    '</ZIMSTER_BOOTSTRAP>'
  ].join('\n');
  writeSync(process.stdout.fd, `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  })}\n`);
}
