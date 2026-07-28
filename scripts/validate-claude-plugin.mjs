#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaudePlugin } from './lib/claude-plugin-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = await validateClaudePlugin(root);
if (errors.length) {
  console.error(`Claude plugin validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Claude plugin structure is valid against the current documented contract.');
}
