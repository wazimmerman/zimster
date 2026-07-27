import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

export async function json(relativePath) {
  return JSON.parse(await read(relativePath));
}

export async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function directories(relativePath) {
  const entries = await readdir(path.join(root, relativePath), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
