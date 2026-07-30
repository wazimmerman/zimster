import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, required, writeError, writeLine } from './lib/cli.mjs';
import {
  COMPLETION_STATES,
  evaluateCandidateCompletion,
  evaluateRequirementMatrix
} from './lib/semantic-assurance.mjs';
import { captureGitState, findRepoRoot } from './lib/git-state.mjs';
import { ensureRuntimeDirectory } from './lib/runtime.mjs';

const { positional, options } = parseOptions(process.argv.slice(2));
const action = positional[0];
const root = findRepoRoot(process.cwd());

async function jsonFile(option) {
  const file = path.resolve(process.cwd(), required(options, option));
  return JSON.parse(await readFile(file, 'utf8'));
}

async function evidenceRecords() {
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
  return rows
    .filter((row) => row.record_type !== 'invalidation')
    .map((row) => ({
      ...row,
      status: invalidated.has(row.id)
        ? 'stale'
        : row.exit_code === 0 ? 'valid' : 'failed'
    }));
}

async function evaluatedMatrix() {
  const requirements = await jsonFile('requirements');
  const matrix = await jsonFile('matrix');
  return {
    matrix,
    result: evaluateRequirementMatrix({
      bindingRequirements: requirements.requirements,
      matrix,
      evidence: await evidenceRecords()
    })
  };
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
  const { matrix, result: evaluatedResult } = await evaluatedMatrix();
  const checkout = await captureGitState(root);
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
  const result = evaluateCandidateCompletion({
    profile: required(options, 'profile'),
    microEligible: options['micro-eligible'] === true,
    ownerVerified: options['owner-verified'] === true,
    reviewUnavailable: options['review-unavailable'] === true,
    matrixResult,
    reviews: reviewFile.reviews || [],
    candidateHead: matrix.candidate_head,
    loadBearingReviewObligationsSatisfied:
      options['load-bearing-review-obligations-satisfied'] === true,
    correctionPending: options['correction-pending'] === true
  });
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
  throw new Error('Usage: semantic-assurance.mjs <matrix|complete> --requirements <file> --matrix <file> [--evidence <jsonl>] [--reviews <json>]');
}
