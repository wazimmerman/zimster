import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodexContract, validateCodexPlugin, validateRepoMarketplace } from './lib/codex-plugin-contract.mjs';
import { syncCodexPlugin } from './sync-codex-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = await loadCodexContract(root);
const errors = [
  ...await validateCodexPlugin(path.join(root, 'plugins', 'zimster'), contract),
  ...await validateRepoMarketplace(root),
  ...(await syncCodexPlugin({ check: true })).map((value) => `Codex mirror: ${value}`)
];

if (errors.length) {
  console.error(`Codex validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Codex validation passed: plugins/zimster and repo marketplace conform to the pinned OpenAI contract snapshot.`);
}
