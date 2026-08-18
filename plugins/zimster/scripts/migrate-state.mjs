import { writeSync } from 'node:fs';
import path from 'node:path';
import { parseOptions } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { migrate070State } from './lib/state-migration.mjs';

const { options } = parseOptions(process.argv.slice(2));
const root = findRepoRoot(process.cwd());
const runtime = options.runtime
  ? path.resolve(process.cwd(), String(options.runtime))
  : await ensureRuntimeDirectory(root);
const { report, reportFile } = await migrate070State({ root, runtime });
writeSync(process.stdout.fd, `${JSON.stringify({
  status: 'MIGRATION_COMPATIBLE',
  run_id: report.run_id,
  report: reportFile
})}\n`);
