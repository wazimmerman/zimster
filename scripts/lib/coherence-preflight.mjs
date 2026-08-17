import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeExecutionBudgetProofIdentities,
  executionBudgetProofReceiptPasses
} from './execution-budget.mjs';
import { captureGitState } from './git-state.mjs';
import { reconcileExecutionAccounting } from './governed-execution.mjs';
import {
  validateAssuranceAccounting,
  validateReviewLifecycle
} from './review-lifecycle.mjs';
import { authenticateFinalReviewAuthorization } from './review-authorization.mjs';
import { checkRunSummary } from './run-summary.mjs';

async function readJsonComponent(file, label, issues) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    issues.push(`${label} is malformed: ${error.message}`);
    return null;
  }
}

async function readReviewLifecycles(runtime, issues) {
  const directory = path.join(runtime, 'review-lifecycle');
  let files;
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    issues.push(`review lifecycle directory is unavailable: ${error.message}`);
    return [];
  }
  const states = await Promise.all(files.map((file) =>
    readJsonComponent(path.join(directory, file), `review lifecycle ${file}`, issues)
  ));
  return states.filter(Boolean);
}

function sameCandidate(checkpoint, git) {
  return checkpoint?.repository_state?.head === git.head
    && checkpoint?.repository_state?.tree === git.tree
    && checkpoint?.repository_state?.dirty_tree_fingerprint === git.dirty_tree_fingerprint;
}

const CURRENT_RECOVERY_STATUSES = new Set([
  'checkpoint_current',
  'CHECKPOINT_CURRENT',
  'CHECKPOINT_RECONSTRUCTED',
  'CONTROL_PLANE_MUTATION_CURRENT',
  'RECONCILED_CONTROL_PLANE_MUTATION',
  'RECONCILED_PARTIAL_MUTATION',
  'RECONCILED_WORKTREE_CHANGE',
  'SLICE_STARTED',
  'SLICE_COMPLETED',
  'VERIFICATION_PASSED'
]);

async function budgetProofIssues(runtime, repo, budget) {
  if (!budget || budget.schema_version !== 1) return ['execution budget is unavailable or malformed'];
  const issues = [];
  const obligations = budget.proof_obligations || [];
  const graph = analyzeExecutionBudgetProofIdentities(budget);
  const valid = new Set();
  for (const [index, proof] of obligations.entries()) {
    if (proof.status === 'required') {
      issues.push(`pending execution-budget proof: ${proof.proof || 'unnamed'}`);
    } else if (proof.status === 'satisfied') {
      let authenticated = false;
      try {
        authenticated = Boolean(proof.receipt_id) && await executionBudgetProofReceiptPasses(
          runtime,
          proof,
          proof.receipt_id,
          { cwd: repo }
        );
      } catch (error) {
        issues.push(`execution-budget proof could not be authenticated: ${proof.proof || 'unnamed'}: ${error.message}`);
      }
      if (!authenticated) {
        issues.push(`execution-budget proof is stale or unauthenticated: ${proof.proof || 'unnamed'}`);
      } else {
        valid.add(index);
      }
    } else if (proof.status === 'superseded') {
      if (!proof.superseded_by || !proof.supersession_reason || !proof.superseded_at) {
        issues.push(`execution-budget proof supersession is incomplete: ${proof.proof || 'unnamed'}`);
      }
    } else {
      issues.push(`execution-budget proof has unsupported state: ${proof.proof || 'unnamed'}`);
    }
  }
  function satisfied(name, sourceType, sourceIndex, seen = new Set()) {
    const index = graph.resolve(name, sourceType, sourceIndex);
    if (index === null || seen.has(index)) return false;
    seen.add(index);
    const proof = obligations[index];
    if (proof?.status === 'satisfied') return valid.has(index);
    if (proof?.status === 'superseded') {
      return satisfied(proof.superseded_by, 'supersession', index, seen);
    }
    return false;
  }
  for (const [index, override] of (budget.overrides || []).entries()) {
    if (!satisfied(override.required_proof, 'override', index)) {
      issues.push(`execution-budget override lacks a current authenticated proof: ${override.required_proof || 'unnamed'}`);
    }
  }
  issues.push(...graph.issues.filter((issue) => !issues.includes(issue)));
  return issues;
}

export async function evaluateCoherence(runtime, repo, {
  operation,
  seamId = 'whole-release',
  profile = 'high-risk'
}) {
  if (!['review', 'completion', 'release'].includes(operation)) {
    throw new Error('coherence operation must be review, completion, or release');
  }
  if (!['micro', 'standard', 'high-risk'].includes(profile)) {
    throw new Error('coherence profile must be micro, standard, or high-risk');
  }
  const reviewRequired = operation !== 'completion' || profile !== 'micro';
  const issues = [];
  const git = await captureGitState(repo);
  const run = await readJsonComponent(path.join(runtime, 'run.json'), 'canonical run state', issues);
  const checkpoint = await readJsonComponent(
    path.join(runtime, 'checkpoints', 'current.json'),
    'canonical recovery checkpoint',
    issues
  );
  const budget = await readJsonComponent(
    path.join(runtime, 'budget.json'),
    'execution budget',
    issues
  );
  const lifecycle = await readJsonComponent(
    path.join(runtime, 'review-lifecycle', `${seamId}.json`),
    'review lifecycle',
    issues
  );
  const reviewLifecycles = await readReviewLifecycles(runtime, issues);
  const assurance = await readJsonComponent(
    path.join(runtime, 'assurance-accounting', 'latest.json'),
    'assurance accounting',
    issues
  );
  const transaction = await readJsonComponent(
    path.join(runtime, 'transactions', 'current.json'),
    'control-plane transaction',
    issues
  );

  if (!run || run.schema_version !== 3) issues.push('canonical run.json schema 3 is unavailable');
  if (transaction) {
    issues.push(`pending control-plane mutation requires resume or reconciliation: ${transaction.transaction_id || 'unidentified'}`);
  }
  if (!checkpoint || checkpoint.schema_version !== 2) {
    issues.push('canonical recovery checkpoint schema 2 is unavailable');
  } else if (run) {
    if (checkpoint.run_id !== run.id || checkpoint.run_state_revision !== run.state_revision) {
      issues.push('checkpoint revision does not match canonical run state');
    }
    if (checkpoint.current_slice?.id !== run.current_slice?.id) {
      issues.push('checkpoint current slice does not match canonical run state');
    }
    if (!sameCandidate(checkpoint, git)) {
      issues.push('checkpoint candidate head/tree/dirty fingerprint differs from the checkout');
    }
    if (checkpoint.active_failure) issues.push('checkpoint has an active failure');
    if (!CURRENT_RECOVERY_STATUSES.has(checkpoint.recovery_status)) {
      issues.push(`checkpoint recovery status is not current: ${checkpoint.recovery_status || 'unavailable'}`);
    }
    if ((checkpoint.blocking_obligations || []).length) {
      issues.push(`checkpoint has blocking remaining obligations: ${checkpoint.blocking_obligations.join('; ')}`);
    }
    if ((checkpoint.open_findings || []).length) {
      issues.push(`checkpoint has open findings: ${checkpoint.open_findings.join('; ')}`);
    }
    for (const receipt of checkpoint.evidence_receipts || []) {
      if (receipt.status !== 'valid') {
        issues.push(`checkpoint evidence is not current: ${receipt.id || 'unnamed'}=${receipt.status || 'unknown'}`);
      }
    }
    for (const guard of checkpoint.guards || checkpoint.guard_assertions || []) {
      if (guard.status !== 'asserted') issues.push(`guard is not asserted: ${guard.id || 'unnamed'}`);
    }
  }
  if (git.dirty_tree_fingerprint !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
    issues.push('candidate checkout is dirty');
  }
  let summary = { current: false };
  if (run) {
    try {
      summary = await checkRunSummary(runtime, { repo });
    } catch (error) {
      issues.push(`run summary could not be checked: ${error.message}`);
    }
  }
  if (!summary.current) issues.push('STALE_RUN_SUMMARY: run.md differs from canonical state');

  let accounting = { status: 'ACCOUNTING_UNAVAILABLE' };
  try {
    accounting = await reconcileExecutionAccounting(runtime, repo, { mutate: false });
  } catch (error) {
    issues.push(`ACCOUNTING_UNAVAILABLE: governed execution accounting could not be checked: ${error.message}`);
  }
  if (accounting.status !== 'ACCOUNTING_CURRENT') {
    issues.push(`${accounting.status}: governed execution receipts and budget projection disagree`);
  }
  issues.push(...await budgetProofIssues(runtime, repo, budget));

  if (!lifecycle && reviewRequired) {
    issues.push(`review lifecycle is unavailable for seam ${seamId}`);
  } else if (lifecycle) {
    try {
      const authenticatedReviewerDispositionIds = [];
      if (operation !== 'review') {
        const authorization = await authenticateFinalReviewAuthorization(
          runtime,
          lifecycle,
          { cwd: repo }
        );
        if (authorization.type === 'reviewer_disposition') {
          authenticatedReviewerDispositionIds.push(authorization.disposition_id);
        }
      }
      validateReviewLifecycle(lifecycle, {
        candidateHead: git.head,
        candidateTree: git.tree,
        requireFinalApproval: operation !== 'review',
        authenticatedReviewerDispositionIds
      });
      if (operation === 'review') {
        const finalAttempts = lifecycle.attempts.filter(({ attempt_id, attempt_type }) =>
          attempt_type === 'final_integration_review'
          && !lifecycle.invalidated_attempt_ids.includes(attempt_id)
        ).length;
        if (lifecycle.status !== 'approved' || !lifecycle.stable) {
          issues.push('final-review admission requires an approved stable semantic candidate');
        }
        if (finalAttempts >= lifecycle.review_policy.final_integration_reviews) {
          issues.push('final-review admission is exhausted and requires strategy escalation');
        }
      }
      if (lifecycle.strategy_escalation?.status === 'required') {
        issues.push('review lifecycle has unresolved strategy escalation');
      }
    } catch (error) {
      issues.push(`review lifecycle is incoherent: ${error.message}`);
    }
  }

  if (operation !== 'review' && reviewRequired) {
    if (!assurance || !lifecycle) {
      issues.push('assurance accounting is unavailable');
    } else {
      try {
        for (const state of reviewLifecycles) validateReviewLifecycle(state);
        const accountingAttempts = reviewLifecycles.flatMap(({ attempts = [] }) => attempts);
        validateAssuranceAccounting(assurance, {
          candidateHead: git.head,
          candidateTree: git.tree,
          recordedReviewAttemptIds: accountingAttempts.map(({ attempt_id }) => attempt_id),
          recordedReviewAttemptCounts: {
            correction_rechecks: accountingAttempts.filter(({ attempt_type }) =>
              attempt_type === 'correction_recheck'
            ).length,
            final_integration_reviews: accountingAttempts.filter(({ attempt_type }) =>
              attempt_type === 'final_integration_review'
            ).length
          },
          requiredReviewerIdentities: reviewLifecycles.map(({ reviewer_identity }) => reviewer_identity)
        });
      } catch (error) {
        issues.push(`assurance accounting is incoherent: ${error.message}`);
      }
    }
  }

  return {
    schema_version: 1,
    status: issues.length ? 'COHERENCE_BLOCKED' : 'COHERENCE_CURRENT',
    operation,
    profile,
    candidate: {
      head: git.head,
      tree: git.tree,
      dirty_tree_fingerprint: git.dirty_tree_fingerprint
    },
    issues: [...new Set(issues)],
    components: {
      run_revision: run?.state_revision ?? null,
      checkpoint_revision: checkpoint?.run_state_revision ?? null,
      accounting_status: accounting.status,
      lifecycle_status: lifecycle?.status || 'unavailable'
    }
  };
}
