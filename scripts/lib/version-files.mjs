import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const manifestFiles = [
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.kimi-plugin/plugin.json'
];

export async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

export async function writeJson(relative, payload) {
  await writeFile(path.join(root, relative), `${JSON.stringify(payload, null, 2)}\n`);
}

export function assertSemver(version) {
  const strict = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!strict.test(version)) throw new Error(`version must be strict semver: ${version}`);
}

export async function versionRecords() {
  const records = [];
  const pkg = await readJson('package.json');
  records.push(['package.json', pkg.version]);
  const lock = await readJson('package-lock.json');
  records.push(['package-lock.json', lock.version]);
  records.push(['package-lock.json packages[""]', lock.packages?.['']?.version]);
  for (const file of manifestFiles) {
    const manifest = await readJson(file);
    records.push([file, manifest.version]);
  }
  const claudeMarketplace = await readJson('.claude-plugin/marketplace.json');
  const entry = claudeMarketplace.plugins?.find((plugin) => plugin.name === 'zimster');
  records.push(['.claude-plugin/marketplace.json', entry?.version]);
  try {
    const mirror = await readJson('plugins/zimster/.codex-plugin/plugin.json');
    records.push(['plugins/zimster/.codex-plugin/plugin.json', mirror.version]);
  } catch {
    records.push(['plugins/zimster/.codex-plugin/plugin.json', undefined]);
  }
  return records;
}

export async function updateVersionFiles(version) {
  assertSemver(version);
  const pkg = await readJson('package.json');
  pkg.version = version;
  await writeJson('package.json', pkg);

  const lock = await readJson('package-lock.json');
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  await writeJson('package-lock.json', lock);

  for (const file of manifestFiles) {
    const manifest = await readJson(file);
    manifest.version = version;
    await writeJson(file, manifest);
  }

  const claudeMarketplace = await readJson('.claude-plugin/marketplace.json');
  const entry = claudeMarketplace.plugins?.find((plugin) => plugin.name === 'zimster');
  if (!entry) throw new Error('Claude marketplace is missing the zimster entry');
  entry.version = version;
  await writeJson('.claude-plugin/marketplace.json', claudeMarketplace);
}
