#!/usr/bin/env node
import { writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaudePlugin } from './lib/claude-plugin-contract.mjs';

function writeLine(stream, message) {
  writeSync(stream.fd, `${message}\n`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = await validateClaudePlugin(root);
if (errors.length) {
  writeLine(process.stderr, `Claude plugin validation failed with ${errors.length} issue(s):`);
  for (const error of errors) writeLine(process.stderr, `- ${error}`);
  process.exitCode = 1;
} else {
  writeLine(process.stdout, 'Claude plugin structure is valid against the current documented contract.');
}
