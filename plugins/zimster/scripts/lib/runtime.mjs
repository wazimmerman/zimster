import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureRuntimeDirectory(repoRoot) {
  const directory = path.join(repoRoot, '.zimster');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return directory;
}
