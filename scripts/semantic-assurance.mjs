import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import {
  COMPLETION_STATES,
  evaluateCandidateCompletion,
  evaluateRequirementMatrix,
  semanticContractDigest
} from './lib/semantic-assurance.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { evidenceStalenessReason } from './lib/evidence-validity.mjs';
import {
  analyzeExecutionBudgetProofIdentities,
  correctionRecheckEpochIssues,
  executionBudgetProofReceiptPasses
} from './lib/execution-budget.mjs';
import { normalizeConvergenceMetric } from './lib/convergence.mjs';
import { canonicalPath } from './lib/path-identity.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';
import { evaluateCoherence } from './lib/coherence-preflight.mjs';
import { withControlPlaneMutation } from './lib/control-plane-mutation.mjs';
import { validateReviewLifecycle } from './lib/review-lifecycle.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

async function jsonFile(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  return JSON.parse(await readFile(file, 'utf8'));
}

async function jsonDocument(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  const data = await readFile(file);
  return {
    file,
    sha256: createHash('sha256').update(data).digest('hex'),
    value: JSON.parse(data.toString('utf8'))
  };
}

async function evidenceRecords(checkout) {
  const runtime = options.evidence
    ? null
    : await ensureRuntimeDirectory(root);
  const file = options.evidence
    ? path.resolve(process.cwd(), String(options.evidence))
    : path.join(runtime, 'evidence', 'receipts.jsonl');
  let rows;
  try {
    rows = (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const invalidated = new Set(
    rows
      .filter((row) => row.record_type === 'invalidation')
      .map((row) => row.receipt_id)
  );
  const records = [];
  for (const row of rows.filter((item) => item.record_type !== 'invalidation')) {
    const staleReason = invalidated.has(row.id)
      ? 'explicitly invalidated'
      : row.exit_code === 0
        ? await evidenceStalenessReason(row, { root, state: checkout })
        : null;
    records.push({
      ...row,
      status: invalidated.has(row.id) || staleReason
        ? 'stale'
        : row.exit_code === 0 ? 'valid' : 'failed',
      ...(staleReason ? { staleness_reason: staleReason } : {})
    });
  }
  return records;
}

async function evaluatedMatrix() {
  const requirements = await jsonFile('requirements');
  const matrixDocument = await jsonDocument('matrix');
  const checkout = await captureGitState(root);
  return {
    matrix: matrixDocument.value,
    matrixSha256: matrixDocument.sha256,
    semanticContractSha256: semanticContractDigest({
      bindingRequirements: requirements.requirements,
      matrix: matrixDocument.value
    }),
    checkout,
    result: evaluateRequirementMatrix({
      bindingRequirements: requirements.requirements,
      matrix: matrixDocument.value,
      evidence: await evidenceRecords(checkout),
      phase: options.phase ? String(options.phase) : 'candidate'
    })
  };
}

async function authoritativeReviewLifecycles(runtimeDirectory) {
  const directory = path.join(runtimeDirectory, 'review-lifecycle');
  let files;
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(files.map(async (file) =>
    validateReviewLifecycle(JSON.parse(await readFile(path.join(directory, file), 'utf8')))
  ));
}

async function executionBudgetIssues(budget, runtimeDirectory, reviewLifecycles) {
  if (!budget || budget.schema_version !== 1) {
    return ['execution budget must be schema v1'];
  }
  if (
    !budget.limits || typeof budget.limits !== 'object'
    || !budget.usage || typeof budget.usage !== 'object'
    || !Array.isArray(budget.overrides)
    || !Array.isArray(budget.proof_obligations)
  ) {
    return ['execution budget requires limits, usage, override, and proof-obligation records'];
  }
  const issues = [];
  const graph = analyzeExecutionBudgetProofIdentities(budget);
  const validSatisfiedProofs = new Set();
  function satisfied(proofName, sourceType, sourceIndex, seen = new Set()) {
    const index = graph.resolve(proofName, sourceType, sourceIndex);
    if (index === null || seen.has(index)) return false;
    seen.add(index);
    const proof = budget.proof_obligations[index];
    if (proof?.status === 'satisfied') return validSatisfiedProofs.has(index);
    if (proof?.status === 'superseded') {
      return satisfied(proof.superseded_by, 'supersession', index, seen);
    }
    return false;
  }
  for (const [index, proof] of budget.proof_obligations.entries()) {
    if (proof.status === 'required') {
      issues.push(`pending execution-budget proof: ${proof.proof || 'unnamed'}`);
    } else if (proof.status === 'superseded') {
      if (!proof.superseded_by || !proof.supersession_reason || !proof.superseded_at) {
        issues.push(`execution-budget proof has an incomplete supersession record: ${proof.proof || 'unnamed'}`);
      }
    } else if (proof.status !== 'satisfied' || !proof.receipt_id) {
      issues.push(`execution-budget proof is not durably satisfied: ${proof.proof || 'unnamed'}`);
    } else {
      const relationshipIsEnforceable = proof.receipt_type === 'verification'
        ? Boolean(proof.profile)
        : proof.receipt_type === 'evidence'
          ? Boolean(proof.kind && proof.scope && proof.command)
          : false;
      if (!relationshipIsEnforceable) {
        issues.push(`execution-budget proof has no enforceable receipt relationship: ${proof.proof || 'unnamed'}`);
      } else if (await executionBudgetProofReceiptPasses(
        runtimeDirectory,
        proof,
        proof.receipt_id,
        { cwd: root }
      )) {
        validSatisfiedProofs.add(index);
      } else {
        issues.push(
          `execution-budget proof receipt ${proof.receipt_id} is absent, invalidated, stale, environment-mismatched, or outside the exact candidate: ${proof.proof || 'unnamed'}`
        );
      }
    }
  }
  issues.push(...correctionRecheckEpochIssues(budget, reviewLifecycles));
  for (const [index, override] of budget.overrides.entries()) {
    if (!satisfied(override.required_proof, 'override', index)) {
      issues.push(`execution-budget override lacks satisfied proof: ${override.required_proof || 'unnamed'}`);
    }
  }
  issues.push(...graph.issues.filter((issue) => !issues.includes(issue)));
  for (const [metric, value] of Object.entries(budget.usage)) {
    if (normalizeConvergenceMetric(metric) !== metric) continue;
    if (metric === 'correction_rechecks') continue;
    const limit = budget.limits[metric];
    if (!Number.isInteger(value) || !Number.isInteger(limit) || value <= limit) continue;
    const coveringOverride = budget.overrides.find((override, index) =>
      normalizeConvergenceMetric(override.metric) === metric
      && Number.isInteger(override.value)
      && override.value >= value
      && satisfied(override.required_proof, 'override', index)
    );
    if (!coveringOverride) {
      issues.push(`execution-budget usage exceeds its limit without a proof-backed override: ${metric}=${value}/${limit}`);
    }
  }
  return [...new Set(issues)];
}

async function matrixDecision() {
  const { result } = await evaluatedMatrix();
  writeLine(JSON.stringify(result));
  const counts = Object.entries(result.counts)
    .map(([state, count]) => `${state}=${count}`)
    .join(' ');
  writeError(`${result.valid ? 'MATRIX_VALID' : 'MATRIX_INCOMPLETE'} ${counts}`);
  for (const issue of result.issues) writeError(`- ${issue}`);
  if (!result.valid) process.exitCode = 2;
}

async function completionDecision() {
  const {
    matrix,
    semanticContractSha256,
    checkout,
    result: evaluatedResult
  } = await evaluatedMatrix();
  const checkoutIssues = [];
  if (matrix.candidate_head !== checkout.head) {
    checkoutIssues.push(
      `requirement matrix candidate head ${matrix.candidate_head} differs from current candidate head ${checkout.head}`
    );
  }
  if (matrix.candidate_tree !== checkout.tree) {
    checkoutIssues.push(
      `requirement matrix candidate tree ${matrix.candidate_tree} differs from current candidate tree ${checkout.tree}`
    );
  }
  if (
    checkout.dirty_tree_fingerprint
    !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  ) {
    checkoutIssues.push('current candidate checkout is dirty');
  }
  const matrixResult = checkoutIssues.length
    ? {
        ...evaluatedResult,
        valid: false,
        allowed_claims: [],
        issues: [...evaluatedResult.issues, ...checkoutIssues]
      }
    : evaluatedResult;
  const reviewFile = options.reviews ? await jsonFile('reviews') : { reviews: [] };
  let hostSmokeReceipt = null;
  try {
    hostSmokeReceipt = options['host-smoke-receipt']
      ? await jsonFile('host-smoke-receipt')
      : JSON.parse(await readFile(path.join(await ensureRuntimeDirectory(root), 'host-smoke', 'latest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const profile = required(options, 'profile');
  const runtimeDirectory = profile === 'micro' ? null : await ensureRuntimeDirectory(root);
  const executionBudgetDocument = profile === 'micro'
    ? null
    : await jsonDocument('execution-budget');
  const executionBudget = executionBudgetDocument?.value || null;
  const reviewLifecycleDocument = profile === 'micro'
    ? null
    : await jsonDocument('review-lifecycle');
  const assuranceAccountingDocument = profile === 'micro'
    ? null
    : await jsonDocument('assurance-accounting');
  const reviewLifecycle = reviewLifecycleDocument?.value || null;
  const reviewLifecycles = profile === 'micro'
    ? []
    : await authoritativeReviewLifecycles(runtimeDirectory);
  const assuranceAccounting = assuranceAccountingDocument?.value || null;
  const reviewPackage = profile === 'micro'
    ? null
    : await jsonFile('review-package');
  const packageIssues = [];
  if (reviewPackage) {
    if (reviewPackage.head !== matrix.candidate_head) {
      packageIssues.push('review package head differs from the requirement matrix candidate');
    }
    if (reviewPackage.semantic_contract?.sha256 !== semanticContractSha256) {
      packageIssues.push('review package semantic contract differs from the current contract');
    }
  }
  const budgetPathIssues = executionBudgetDocument
    && await canonicalPath(executionBudgetDocument.file)
      !== await canonicalPath(path.join(runtimeDirectory, 'budget.json'))
    ? ['completion requires the authoritative Git-local execution budget']
    : [];
  const lifecyclePathIssues = reviewLifecycleDocument
    && await canonicalPath(reviewLifecycleDocument.file)
      !== await canonicalPath(path.join(
        runtimeDirectory,
        'review-lifecycle',
        `${reviewLifecycle.seam_id}.json`
      ), { allowMissing: true })
    ? ['completion requires the authoritative Git-local review lifecycle']
    : [];
  const accountingPathIssues = assuranceAccountingDocument
    && await canonicalPath(assuranceAccountingDocument.file)
      !== await canonicalPath(
        path.join(runtimeDirectory, 'assurance-accounting', 'latest.json'),
        { allowMissing: true }
      )
    ? ['completion requires the authoritative Git-local assurance accounting receipt']
    : [];
  const budgetIssues = executionBudget
    ? await executionBudgetIssues(executionBudget, runtimeDirectory, reviewLifecycles)
    : [];
  const coherence = await evaluateCoherence(runtimeDirectory, root, {
    operation: 'completion',
    seamId: reviewLifecycle?.seam_id || 'whole-release',
    profile
  });
  const completionInputIssues = [
    ...packageIssues,
    ...budgetPathIssues,
    ...lifecyclePathIssues,
    ...accountingPathIssues,
    ...budgetIssues,
    ...coherence.issues
  ];
  const finalMatrixResult = completionInputIssues.length
    ? {
        ...matrixResult,
        valid: false,
        allowed_claims: [],
        issues: [...matrixResult.issues, ...completionInputIssues]
      }
    : matrixResult;
  const result = evaluateCandidateCompletion({
    profile,
    microEligibility: options['micro-eligibility']
      ? await jsonFile('micro-eligibility')
      : null,
    ownerVerified: options['owner-verified'] === true,
    reviewUnavailable: options['review-unavailable'] === true,
    matrixResult: finalMatrixResult,
    reviews: reviewFile.reviews || [],
    candidateBase: reviewPackage?.base,
    candidateHead: matrix.candidate_head,
    candidateTree: matrix.candidate_tree,
    reviewPackageId: reviewPackage?.id,
    semanticContractSha256,
    requiredLenses: reviewPackage?.lenses || [],
    loadBearingReviewObligations: options['load-bearing-review-obligations']
      ? await jsonFile('load-bearing-review-obligations')
      : null,
    hostSmokeReceipt,
    releaseChannel: options['release-channel'] ? String(options['release-channel']) : 'public_beta',
    correctionPending: options['correction-pending'] === true,
    reviewLifecycle,
    reviewLifecycles,
    assuranceAccounting
  });
  if (result.state === COMPLETION_STATES.CANDIDATE_COMPLETE) {
    await withControlPlaneMutation(runtimeDirectory, root, {
      mutationType: 'candidate_completion_recorded',
      atomicFailure: true
    }, async () => result);
  }
  writeLine(JSON.stringify(result));
  writeError(`${result.state} review=${result.review_id || 'none'} claims=${result.allowed_claims.length}`);
  for (const reason of result.reasons) writeError(`- ${reason}`);
  if (result.state !== COMPLETION_STATES.CANDIDATE_COMPLETE) process.exitCode = 2;
}

if (action === 'matrix') {
  await matrixDecision();
} else if (action === 'complete') {
  await completionDecision();
} else {
  throw new Error('Usage: semantic-assurance.mjs <matrix|complete> --requirements <file> --matrix <file> [--evidence <jsonl>] [--reviews <json>] [--review-package <json>] [--review-lifecycle <json>] [--assurance-accounting <json>] [--execution-budget <json>]');
}
