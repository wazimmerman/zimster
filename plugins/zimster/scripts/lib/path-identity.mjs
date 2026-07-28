import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function nativePath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  const text = String(value);
  return text.startsWith('file:') ? fileURLToPath(text) : text;
}

function withoutWindowsNamespace(value) {
  if (process.platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  return value;
}

function normalizedCanonicalPath(value) {
  let normalized = path.normalize(withoutWindowsNamespace(value));
  if (process.platform === 'win32' && /^[a-z]:\\/i.test(normalized)) {
    normalized = `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

export async function canonicalPath(value, { allowMissing = false } = {}) {
  const absolute = path.resolve(nativePath(value));
  try {
    return normalizedCanonicalPath(await realpath(absolute));
  } catch (error) {
    if (error.code !== 'ENOENT' || !allowMissing) throw error;
  }

  const suffix = [];
  let current = absolute;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`unable to canonicalize path: ${absolute}`);
    suffix.unshift(path.basename(current));
    current = parent;
    try {
      return normalizedCanonicalPath(path.join(await realpath(current), ...suffix));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function equivalentCanonicalPaths(left, right) {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function relativeInside(repository, target) {
  const relative = path.relative(repository, target);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`path is outside the repository: ${target}`);
  }
  return relative;
}

function portableRelative(value) {
  return value ? value.split(path.sep).join('/') : '.';
}

export async function repositoryRelativeIdentity(repository, target, options = {}) {
  const canonicalRepository = await canonicalPath(repository);
  const canonicalTarget = await canonicalPath(target, options);
  return portableRelative(relativeInside(canonicalRepository, canonicalTarget));
}

export async function reviewFileIdentity(repository, requested, {
  base = repository,
  allowMissing = true
} = {}) {
  const canonicalRepository = await canonicalPath(repository);
  const requestedPath = String(requested).startsWith('file:')
    ? fileURLToPath(String(requested))
    : path.resolve(base, String(requested));
  const canonicalTarget = await canonicalPath(requestedPath, { allowMissing });
  try {
    return portableRelative(relativeInside(canonicalRepository, canonicalTarget));
  } catch (error) {
    if (!/outside the repository/.test(error.message)) throw error;
    return pathToFileURL(canonicalTarget).href;
  }
}

export function pathFromIdentity(repository, identity) {
  const text = String(identity);
  if (text.startsWith('file:')) return normalizedCanonicalPath(fileURLToPath(text));
  if (path.isAbsolute(text) || text.includes('\\')) {
    throw new Error(`non-canonical repository path identity: ${text}`);
  }
  const absolute = path.resolve(repository, ...text.split('/'));
  relativeInside(path.resolve(repository), absolute);
  return absolute;
}

export async function directInvocation(moduleUrl, argvPath) {
  if (!argvPath) return false;
  try {
    const modulePath = await canonicalPath(fileURLToPath(moduleUrl));
    const entryPath = await canonicalPath(argvPath);
    return equivalentCanonicalPaths(modulePath, entryPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function environmentValue(environment, name) {
  const match = Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] ?? '';
}

async function accessibleExecutable(candidate) {
  try {
    await access(
      candidate,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export async function executableAvailable(command, {
  cwd = process.cwd(),
  environment = process.env
} = {}) {
  const value = String(command);
  const hasDirectory = path.isAbsolute(value) || value.includes('/') || value.includes('\\');
  const directories = hasDirectory
    ? ['']
    : environmentValue(environment, 'PATH').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' && !path.extname(value)
    ? environmentValue(environment, 'PATHEXT').split(';').filter(Boolean)
    : [''];
  if (process.platform === 'win32' && !extensions.length) {
    extensions.push('.COM', '.EXE', '.BAT', '.CMD');
  }
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = hasDirectory
        ? path.resolve(cwd, `${value}${extension}`)
        : path.join(directory, `${value}${extension}`);
      if (await accessibleExecutable(candidate)) return true;
    }
  }
  return false;
}
