import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function capabilityMatrix(root = packageRoot) {
  return JSON.parse(await readFile(path.join(root, 'config', 'harness-capabilities.json'), 'utf8'));
}

export async function harnessCapabilities(harness, root = packageRoot) {
  const matrix = await capabilityMatrix(root);
  const record = matrix.harnesses[harness];
  if (!record) throw new Error(`unknown harness: ${harness}`);
  return record.capabilities;
}
