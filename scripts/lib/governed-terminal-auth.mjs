import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function authenticateGovernedEvidenceReceipt(runtime, receipt, terminalBytes) {
  if (receipt?.issuer !== 'zimster.evidence'
    || !/^[0-9a-f-]{36}$/.test(String(receipt.execution_id || ''))) return false;
  let execution;
  let events;
  try {
    execution = JSON.parse(await readFile(
      path.join(runtime, 'executions', 'receipts', `${receipt.execution_id}.json`),
      'utf8'
    ));
    events = (await readFile(path.join(runtime, 'executions', 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const starts = events.filter((row) =>
    row.event_type === 'execution_started' && row.execution_id === execution.id
  );
  const finishes = events.filter((row) =>
    row.event_type === 'execution_finished' && row.execution_id === execution.id
  );
  const candidate = {
    head: receipt.git_commit || receipt.git_head,
    tree: receipt.git_tree,
    dirty_tree_fingerprint: receipt.dirty_tree_fingerprint
  };
  const digest = createHash('sha256').update(terminalBytes).digest('hex');
  return execution.id === receipt.execution_id
    && execution.issuer === receipt.issuer
    && execution.status === (receipt.exit_code === 0 ? 'passed' : 'failed')
    && execution.exit_code === receipt.exit_code
    && execution.terminal_receipt_type === 'evidence'
    && execution.terminal_receipt_id === receipt.id
    && execution.terminal_receipt_sha256 === digest
    && JSON.stringify(execution.candidate) === JSON.stringify(candidate)
    && ['platform', 'release', 'arch', 'node'].every((name) =>
      execution.environment?.[name] === receipt.environment?.[name]
    )
    && execution.runtime_provenance?.issuer === 'zimster.evidence'
    && typeof execution.runtime_provenance?.runtime_origin === 'string'
    && execution.runtime_provenance.runtime_origin.length > 0
    && execution.governing_policy
    && typeof execution.governing_policy === 'object'
    && starts.length === 1
    && starts[0].issuer === execution.issuer
    && starts[0].command_identity === execution.command_identity
    && JSON.stringify(starts[0].candidate) === JSON.stringify(execution.candidate)
    && finishes.length === 1
    && finishes[0].issuer === execution.issuer
    && finishes[0].status === execution.status
    && finishes[0].exit_code === execution.exit_code
    && finishes[0].terminal_receipt_type === execution.terminal_receipt_type
    && finishes[0].terminal_receipt_id === execution.terminal_receipt_id
    && finishes[0].terminal_receipt_sha256 === execution.terminal_receipt_sha256
    && Number.isFinite(Date.parse(execution.started_at))
    && Number.isFinite(Date.parse(execution.ended_at))
    && Date.parse(execution.started_at) <= Date.parse(execution.ended_at);
}
