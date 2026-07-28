import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, required } from './lib/cli.mjs';
import { buildMetadata } from './lib/build-metadata.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { runGit } from './lib/git-state.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSkills = path.join(sourceRoot, 'skills');
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function directoryNames(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && skillName.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function readRegistry(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(value.owned_skills) || !value.owned_skills.every((name) => skillName.test(name))) {
      throw new Error('owned_skills must contain safe skill directory names');
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { schema_version: 1, owned_skills: [] };
    throw new Error(`invalid prior Zimster skills registry: ${error.message}`);
  }
}

function exclusionBlock(names) {
  return [
    '# BEGIN ZIMSTER SKILLS',
    ...names.map((name) => `/.agents/skills/${name}/`),
    '/.agents/skills/.zimster-install.json',
    '# END ZIMSTER SKILLS'
  ].join('\n');
}

function replaceExclusionBlock(contents, block) {
  const pattern = /(?:^|\n)# BEGIN ZIMSTER SKILLS\n[\s\S]*?\n# END ZIMSTER SKILLS(?:\n|$)/;
  const without = contents.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return `${without ? `${without}\n\n` : ''}${block}\n`;
}

async function optionalFile(file) {
  try {
    return { exists: true, contents: await readFile(file, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, contents: '' };
    throw error;
  }
}

async function restoreFile(file, prior) {
  if (prior.exists) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, prior.contents);
  } else {
    await rm(file, { force: true });
  }
}

export async function syncSkills({
  requestedTarget,
  dryRun = false,
  onPhase = async () => {}
}) {
  requestedTarget = path.resolve(requestedTarget);
  let target;
  try {
    target = await realpath(requestedTarget);
    if (!(await lstat(target)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`target must be an existing Git repository directory: ${requestedTarget}`);
  }
  const repository = String(runGit(['rev-parse', '--show-toplevel'], target, { allowFailure: true }).stdout).trim();
  if (!repository || await realpath(repository) !== target) {
    throw new Error(`target must be the root of a Git repository: ${requestedTarget}`);
  }

  const destination = path.join(target, '.agents', 'skills');
  const registryPath = path.join(destination, '.zimster-install.json');
  const currentSkills = await directoryNames(sourceSkills);
  const prior = await readRegistry(registryPath);
  const owned = [...new Set(prior.owned_skills)].sort();
  const collisions = [];
  for (const name of currentSkills) {
    if (owned.includes(name)) continue;
    try {
      await lstat(path.join(destination, name));
      collisions.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (collisions.length) {
    throw new Error(
      `refusing to replace unowned skill collision(s): ${collisions.join(', ')}; move them or add verified ownership to ${registryPath}`
    );
  }
  const metadata = await buildMetadata(sourceRoot, 'skills-only');
  const registry = {
    schema_version: 1,
    semantic_version: metadata.semantic_version,
    build_id: metadata.build_id,
    owned_skills: currentSkills
  };
  const excludePath = String(runGit(
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    target
  ).stdout).trim();
  const result = {
    schema_version: 1,
    dry_run: dryRun,
    target,
    destination,
    removed_owned_skills: prior.owned_skills.filter((name) => !currentSkills.includes(name)),
    installed_skills: currentSkills,
    metadata
  };
  if (dryRun) {
    return result;
  }

  const priorRegistry = await optionalFile(registryPath);
  const priorExclude = await optionalFile(excludePath);
  const runtime = await ensureRuntimeDirectory(target);
  const stage = await mkdtemp(path.join(runtime, 'sync-skills-'));
  const stagedSkills = path.join(stage, 'skills');
  const backup = path.join(stage, 'backup');
  const installed = [];
  const backedUp = [];
  let registryTouched = false;
  let exclusionTouched = false;
  try {
    await cp(sourceSkills, stagedSkills, { recursive: true });
    const metadataPath = path.join(stagedSkills, 'using-zimster', 'references', 'build-metadata.json');
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await mkdir(destination, { recursive: true });
    await mkdir(backup, { recursive: true });

    for (const name of owned) {
      const existing = path.join(destination, name);
      try {
        await lstat(existing);
        await rename(existing, path.join(backup, name));
        backedUp.push(name);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const name of currentSkills) {
      await rename(path.join(stagedSkills, name), path.join(destination, name));
      installed.push(name);
    }
    await mkdir(path.dirname(excludePath), { recursive: true });
    exclusionTouched = true;
    await writeFile(excludePath, replaceExclusionBlock(priorExclude.contents, exclusionBlock(currentSkills)));
    registryTouched = true;
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    await onPhase('metadata-written');
  } catch (error) {
    for (const name of installed) await rm(path.join(destination, name), { recursive: true, force: true });
    for (const name of backedUp) await rename(path.join(backup, name), path.join(destination, name));
    if (registryTouched) await restoreFile(registryPath, priorRegistry);
    if (exclusionTouched) await restoreFile(excludePath, priorExclude);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return result;
}

async function main() {
  const { options } = parseOptions(process.argv.slice(2));
  const result = await syncSkills({
    requestedTarget: required(options, 'target'),
    dryRun: options['dry-run'] === true
  });
  console.log(JSON.stringify(result));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
