import { writeSync } from 'node:fs';
import { parseOptions } from './lib/cli.mjs';
import { findRepoRoot } from './lib/git-state.mjs';
import { reconcileExecutionAccounting } from './lib/governed-execution.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const repo = findRepoRoot(process.cwd());
const runtime = await ensureRuntimeDirectory(repo);

if (action === 'reconcile') {
  const report = await withControlPlaneMutation(runtime, repo, {
    mutationType: 'execution_accounting_reconciled'
  }, () => reconcileExecutionAccounting(runtime, repo, {
    mutate: true,
    reason: options.reason ? String(options.reason) : null
  }));
  writeSync(process.stdout.fd, `${JSON.stringify(report)}\n`);
} else if (action === 'check') {
  const report = await reconcileExecutionAccounting(runtime, repo, { mutate: false });
  const output = {
    ...report,
    operation: options.operation ? String(options.operation) : null
  };
  writeSync(process.stdout.fd, `${JSON.stringify(output)}\n`);
  if (report.status !== 'ACCOUNTING_CURRENT') process.exitCode = 2;
} else {
  throw new Error('Usage: accounting-reconcile.mjs <check|reconcile> [--operation name]');
}
