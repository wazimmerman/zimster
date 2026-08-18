import { lstat } from 'node:fs/promises';

export function normalizeGitFileMode(mode) {
  if (!Number.isInteger(mode)) throw new Error('file mode must be an integer');
  return (mode & 0o111) === 0 ? 0o100644 : 0o100755;
}

export async function expectedReviewDirectoryCollision(error, destination, stat = lstat) {
  if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) return true;
  if (error?.code !== 'EPERM') return false;
  try {
    return (await stat(destination)).isDirectory();
  } catch {
    return false;
  }
}
