import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_STATES,
  evaluateCandidateCompletion,
  evaluateRequirementMatrix,
  independentApprovalFor,
  semanticContractDigest,
  selectSemanticLenses,
  validateHostSmokeReceipt,
  validateReviewRecord
} from '../scripts/lib/semantic-assurance.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const MATRIX_SHA = 'd'.repeat(64);
const CONTRACT_SHA = 'e'.repeat(64);
const CLEAN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REQUIRED_LENSES = ['mission-scope', 'test-falsifiability'];

function review(overrides = {}) {
  return {
    schema_version: 1,
    id: 'review-001',
    review_type: 'independent_review',
    owner_inline: false,
    base_sha: SHA_A,
    head_sha: SHA_B,
    reviewer_identity: 'reviewer-1',
    dispatch_record_id: null,
    clean_bounded_context: true,
    reviewed_requirement_ids: ['ASSURANCE-001', 'GATE-001', 'GATE-002'],
    intended_claims: ['Independent review is required for Standard work.'],
    semantic_lenses: ['mission-scope'],
    review_scope: 'integration',
    verdict: 'approved',
    findings: [],
    unverified_obligations: [],
    reviewed_at: '2026-07-30T12:00:00.000Z',
    review_package_id: 'package-001',
    requirement_matrix_sha256: MATRIX_SHA,
    semantic_contract_sha256: CONTRACT_SHA,
    checkout_integrity_result: 'REVIEW_CHECKOUT_UNCHANGED',
    ...overrides
  };
}

function approvalOptions(overrides = {}) {
  return {
    profile: 'standard',
    candidateBase: SHA_A,
    candidateHead: SHA_B,
    reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA,
    requiredLenses: REQUIRED_LENSES,
    reviews: [review({ semantic_lenses: REQUIRED_LENSES })],
    bindingRequirementIds: ['ASSURANCE-001'],
    intendedClaims: ['Independent review is required for Standard work.'],
    ...overrides
  };
}

test('owner-inline review must be labeled self_review', () => {
  assert.throws(
    () => validateReviewRecord(review({ owner_inline: true })),
    /owner-inline review must use self_review/
  );
  assert.doesNotThrow(() => validateReviewRecord(review({
    owner_inline: true,
    review_type: 'self_review'
  })));
  const missingContract = review();
  delete missingContract.semantic_contract_sha256;
  assert.throws(
    () => validateReviewRecord(missingContract),
    /semantic_contract_sha256/
  );
});

test('self-review never satisfies Standard or High-risk independent review', () => {
  const selfReview = review({
    review_type: 'self_review',
    owner_inline: true,
    verdict: 'approved'
  });
  for (const profile of ['standard', 'high-risk']) {
    assert.deepEqual(
      independentApprovalFor({
        ...approvalOptions({
          profile,
          reviews: [selfReview]
        }),
      }),
      {
        approved: false,
        state: COMPLETION_STATES.REVIEW_PENDING,
        reason: 'independent semantic review is required'
      }
    );
  }
});

test('approved clean-context independent review satisfies the exact Standard candidate', () => {
  assert.deepEqual(
    independentApprovalFor({
      ...approvalOptions()
    }),
    {
      approved: true,
      state: COMPLETION_STATES.SEMANTIC_REVIEW_APPROVED,
      reviewId: 'review-001'
    }
  );
});

test('an approved review cannot carry load-bearing findings or unresolved obligations', () => {
  for (const severity of ['Critical', 'Important']) {
    assert.throws(() => validateReviewRecord(review({
      findings: [{ severity, summary: 'completion gate bypass' }]
    })), /approved.*finding|contradict/i);
  }
  assert.throws(() => validateReviewRecord(review({
    unverified_obligations: ['Exact-head verification remains unresolved.']
  })), /approved.*obligation|contradict/i);
});

test('review finding severity is canonical and fails closed before approval', () => {
  for (const severity of ['critical', 'IMPORTANT', 'ImPoRtAnT', 'unknown', '', null, {}, []]) {
    assert.throws(() => validateReviewRecord(review({
      findings: [{ severity, summary: 'must not be ignored' }]
    })), /finding.*severity|severity.*Critical.*Important.*Minor/i);
  }
  assert.throws(() => validateReviewRecord(review({
    findings: [{ severity: 'Minor', summary: '' }]
  })), /finding.*summary/i);
  assert.throws(() => validateReviewRecord(review({
    findings: [{ severity: 'Minor', summary: 'valid content', ambiguous: true }]
  })), /finding.*unsupported|unsupported.*finding/i);

  assert.doesNotThrow(() => validateReviewRecord(review({
    findings: [{ severity: 'Minor', summary: 'non-load-bearing observation' }]
  })));
  assert.doesNotThrow(() => validateReviewRecord(review({
    verdict: 'needs_correction',
    findings: [{
      severity: 'Important',
      count: 4,
      summary: 'Canonical historical schema-v1 finding remains readable.'
    }]
  })));
});

test('checkout integrity never substitutes for semantic approval', () => {
  assert.deepEqual(
    independentApprovalFor({
      ...approvalOptions({
        reviews: [review({
          verdict: 'blocked_by_missing_evidence',
          semantic_lenses: REQUIRED_LENSES
        })]
      })
    }),
    {
      approved: false,
      state: COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE,
      reason: 'independent review verdict is blocked_by_missing_evidence'
    }
  );
  assert.deepEqual(
    independentApprovalFor({
      ...approvalOptions({
        reviews: [review({
          checkout_integrity_result: 'REVIEW_CHECKOUT_CHANGED',
          semantic_lenses: REQUIRED_LENSES
        })]
      })
    }),
    {
      approved: false,
      state: COMPLETION_STATES.REVIEW_PENDING,
      reason: 'review checkout integrity was not established'
    }
  );
});

test('approval is bound to the exact base, package, semantic contract, and required lenses', () => {
  for (const [field, value, expected] of [
    ['candidateBase', 'f'.repeat(40), /base/i],
    ['reviewPackageId', 'package-002', /package/i],
    ['semanticContractSha256', 'f'.repeat(64), /semantic contract/i]
  ]) {
    const result = independentApprovalFor(approvalOptions({ [field]: value }));
    assert.equal(result.approved, false);
    assert.match(result.reason, expected);
  }
  const result = independentApprovalFor(approvalOptions({
    requiredLenses: [...REQUIRED_LENSES, 'shared-control-flow']
  }));
  assert.equal(result.approved, false);
  assert.match(result.reason, /lens/i);
});

test('mutable matrix evidence state does not invalidate an unchanged reviewed semantic contract', () => {
  assert.deepEqual(
    independentApprovalFor(approvalOptions({
      reviews: [review({
        requirement_matrix_sha256: 'f'.repeat(64),
        semantic_lenses: REQUIRED_LENSES
      })]
    })),
    {
      approved: true,
      state: COMPLETION_STATES.SEMANTIC_REVIEW_APPROVED,
      reviewId: 'review-001'
    }
  );
});

test('semantic contract digest ignores proof state but changes with binding meaning', () => {
  const bindingRequirements = binding('GATE-001');
  const matrix = {
    schema_version: 1,
    candidate_head: SHA_B,
    candidate_tree: TREE,
    requirements: [matrixEntry('GATE-001')],
    observations: []
  };
  const digest = semanticContractDigest({ bindingRequirements, matrix });
  const mutableProofState = structuredClone(matrix);
  mutableProofState.requirements[0].status = 'partially_verified';
  mutableProofState.requirements[0].evidence_refs = ['later-final-receipt'];
  mutableProofState.requirements[0].unavailable_proof = ['Final proof pending.'];
  mutableProofState.observations.push({ id: 'later-final-observation' });
  assert.equal(
    semanticContractDigest({ bindingRequirements, matrix: mutableProofState }),
    digest
  );
  assert.notEqual(
    semanticContractDigest({
      bindingRequirements: [{ id: 'GATE-001', text: 'Changed binding requirement.' }],
      matrix
    }),
    digest
  );
  const changedClaim = structuredClone(matrix);
  changedClaim.requirements[0].intended_acceptance_claims = ['Changed claim.'];
  assert.notEqual(
    semanticContractDigest({ bindingRequirements, matrix: changedClaim }),
    digest
  );
  const changedImplementationContract = structuredClone(matrix);
  changedImplementationContract.requirements[0].implementation_locations = [
    'scripts/changed-contract.mjs'
  ];
  assert.notEqual(
    semanticContractDigest({
      bindingRequirements,
      matrix: changedImplementationContract
    }),
    digest
  );
});

function binding(...ids) {
  return ids.map((id) => ({ id, text: `Binding requirement ${id}.` }));
}

function matrixEntry(id, overrides = {}) {
  return {
    id,
    authoritative_text: `Binding requirement ${id}.`,
    source: `plan.md#${id.toLowerCase()}`,
    implementation_locations: ['scripts/example.mjs'],
    evidence_refs: [`evidence-${id}`],
    evidence_scope: {
      git_tree: 'candidate',
      environment: 'node-linux'
    },
    unavailable_proof: [],
    status: 'verified',
    intended_acceptance_claims: [`Claim ${id}.`],
    ...overrides
  };
}

function scopedEvidence(id, overrides = {}) {
  return {
    id: `evidence-${id}`,
    status: 'valid',
    requirement_ids: [id],
    establishes: [`Claim ${id}.`],
    does_not_establish: [],
    environment_scope: 'node-linux',
    git_commit: SHA_B,
    git_tree: TREE,
    dirty_tree_fingerprint: CLEAN_FINGERPRINT,
    ...overrides
  };
}

function evaluate(entries, bindingRequirements, evidence) {
  return evaluateRequirementMatrix({
    bindingRequirements,
    matrix: {
      schema_version: 1,
      candidate_head: SHA_B,
      candidate_tree: TREE,
      requirements: entries,
      observations: []
    },
    evidence
  });
}

test('a complete matrix derives only evidence-backed acceptance claims', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001'), matrixEntry('CLAIM-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [scopedEvidence('MATRIX-001'), scopedEvidence('CLAIM-001')]
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, {
    verified: 2,
    partially_verified: 0,
    unverified: 0,
    blocked_by_environment: 0,
    blocked_by_requirement: 0,
    not_applicable: 0
  });
  assert.deepEqual(result.allowed_claims, ['Claim CLAIM-001.', 'Claim MATRIX-001.']);
  assert.deepEqual(result.unverified_obligations, []);
});

test('not_applicable requirements require a reason and scoped evidence', () => {
  const withoutReason = evaluate(
    [matrixEntry('MATRIX-001', {
      status: 'not_applicable',
      evidence_refs: [],
      intended_acceptance_claims: []
    })],
    binding('MATRIX-001'),
    []
  );
  assert.equal(withoutReason.valid, false);
  assert.match(withoutReason.issues.join('\n'), /not_applicable.*reason/i);

  const withoutEvidence = evaluate(
    [matrixEntry('MATRIX-001', {
      status: 'not_applicable',
      evidence_refs: [],
      intended_acceptance_claims: [],
      not_applicable_reason: 'The target interface is absent.'
    })],
    binding('MATRIX-001'),
    []
  );
  assert.equal(withoutEvidence.valid, false);
  assert.match(withoutEvidence.issues.join('\n'), /not_applicable.*evidence/i);

  const withBoth = evaluate(
    [matrixEntry('MATRIX-001', {
      status: 'not_applicable',
      intended_acceptance_claims: [],
      not_applicable_reason: 'The target interface is absent.'
    })],
    binding('MATRIX-001'),
    [scopedEvidence('MATRIX-001')]
  );
  assert.equal(withBoth.valid, true);
});

test('a missing binding requirement blocks matrix completion', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [scopedEvidence('MATRIX-001')]
  );
  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /CLAIM-001.*missing/i);
});

test('stale evidence blocks only the affected requirement and claim', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001'), matrixEntry('CLAIM-001')],
    binding('MATRIX-001', 'CLAIM-001'),
    [
      scopedEvidence('MATRIX-001'),
      scopedEvidence('CLAIM-001', { status: 'stale' })
    ]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, ['Claim MATRIX-001.']);
  assert.match(result.unverified_obligations.join('\n'), /CLAIM-001.*stale/i);
});

test('narrow evidence cannot establish a broader compatibility claim', () => {
  const broadClaim = 'All custom locations, inheritance, precedence, abbreviations, and dynamic behavior are compatible.';
  const result = evaluate(
    [matrixEntry('CLAIM-001', { intended_acceptance_claims: [broadClaim] })],
    binding('CLAIM-001'),
    [scopedEvidence('CLAIM-001', {
      establishes: ['Default wrapper invocation and argument forwarding work.'],
      does_not_establish: [broadClaim],
      environment_scope: 'native-default-wrapper-harness'
    })]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, []);
  assert.match(result.unverified_obligations.join('\n'), /broader|not establish|scope/i);
});

test('evidence from a dirty checkout cannot prove the committed candidate tree', () => {
  const result = evaluate(
    [matrixEntry('MATRIX-001')],
    binding('MATRIX-001'),
    [scopedEvidence('MATRIX-001', { dirty_tree_fingerprint: 'd'.repeat(64) })]
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.allowed_claims, []);
  assert.match(result.unverified_obligations.join('\n'), /dirty checkout/i);
});

const COMPLETE_MATRIX = Object.freeze({
  valid: true,
  binding_requirement_ids: ['ASSURANCE-001', 'GATE-001', 'GATE-002'],
  valid_evidence_ids: ['evidence-micro', 'evidence-load-bearing'],
  evidence_support: [
    {
      id: 'evidence-micro',
      requirement_ids: ['GATE-001'],
      establishes: ['Micro eligibility is deterministically established.'],
      does_not_establish: []
    },
    {
      id: 'evidence-load-bearing',
      requirement_ids: ['GATE-002'],
      establishes: ['High-risk load-bearing architecture is satisfied.'],
      does_not_establish: []
    }
  ],
  counts: {
    verified: 1,
    partially_verified: 0,
    unverified: 0,
    blocked_by_environment: 0,
    blocked_by_requirement: 0,
    not_applicable: 0
  },
  allowed_claims: ['Candidate claim.'],
  unverified_obligations: [],
  issues: []
});

function microEligibility(overrides = {}) {
  return {
    schema_version: 1,
    candidate_head: SHA_B,
    candidate_tree: TREE,
    dimensions: {
      blast_radius: 'low',
      concurrency: 'low',
      security_data: 'low',
      boundary: 'low',
      novelty: 'low',
      observability: 'low'
    },
    coherent_slice: true,
    public_contract: false,
    hard_triggers: [],
    requirement_id: 'GATE-001',
    claim: 'Micro eligibility is deterministically established.',
    deterministic_proof_refs: ['evidence-micro'],
    ...overrides
  };
}

function loadBearingObligations(overrides = {}) {
  return {
    schema_version: 1,
    candidate_head: SHA_B,
    candidate_tree: TREE,
    obligations: [{
      id: 'load-bearing-architecture',
      requirement_id: 'GATE-002',
      claim: 'High-risk load-bearing architecture is satisfied.',
      status: 'satisfied',
      evidence_refs: ['evidence-load-bearing']
    }],
    ...overrides
  };
}

test('eligible Micro work can complete owner-only', () => {
  assert.deepEqual(evaluateCandidateCompletion({
    profile: 'micro',
    microEligibility: microEligibility(),
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [],
    candidateHead: SHA_B,
    candidateTree: TREE
  }), {
    state: COMPLETION_STATES.CANDIDATE_COMPLETE,
    allowed_claims: ['Candidate claim.'],
    review_id: null,
    reasons: []
  });
});

test('Micro completion rejects boolean self-attestation and stale eligibility records', () => {
  for (const input of [
    { microEligible: true },
    { microEligibility: microEligibility({ candidate_head: 'e'.repeat(40) }) },
    { microEligibility: microEligibility({
      dimensions: { ...microEligibility().dimensions, novelty: 'medium' }
    }) },
    { microEligibility: microEligibility({ deterministic_proof_refs: ['missing'] }) },
    { microEligibility: microEligibility({ requirement_id: 'GATE-002' }) },
    { microEligibility: microEligibility({ claim: 'A different or narrower claim.' }) }
  ]) {
    const result = evaluateCandidateCompletion({
      profile: 'micro',
      ...input,
      ownerVerified: true,
      matrixResult: COMPLETE_MATRIX,
      candidateHead: SHA_B,
      candidateTree: TREE
    });
    assert.equal(result.state, COMPLETION_STATES.PARTIALLY_VERIFIED);
    assert.match(result.reasons.join('\n'), /Micro.*eligibility/i);
  }
});

test('Standard and High-risk work with only self-review remain review pending', () => {
  const selfReview = review({
    review_type: 'self_review',
    owner_inline: true,
    verdict: 'approved'
  });
  for (const profile of ['standard', 'high-risk']) {
    const result = evaluateCandidateCompletion({
      profile,
      ownerVerified: true,
      reviewUnavailable: false,
      matrixResult: COMPLETE_MATRIX,
      reviews: [selfReview],
      candidateHead: SHA_B,
      candidateTree: TREE,
      candidateBase: SHA_A,
      reviewPackageId: 'package-001',
      semanticContractSha256: CONTRACT_SHA,
      requiredLenses: REQUIRED_LENSES,
      loadBearingReviewObligations: loadBearingObligations()
    });
    assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
    assert.match(result.reasons.join('\n'), /independent semantic review/i);
  }
});

test('complete Standard proof and exact independent approval reach candidate complete', () => {
  assert.deepEqual(evaluateCandidateCompletion({
    profile: 'standard',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({
      intended_claims: ['Candidate claim.'],
      semantic_lenses: REQUIRED_LENSES
    })],
    candidateHead: SHA_B,
    candidateTree: TREE,
    candidateBase: SHA_A,
    reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA,
    requiredLenses: REQUIRED_LENSES
  }), {
    state: COMPLETION_STATES.CANDIDATE_COMPLETE,
    allowed_claims: ['Candidate claim.'],
    review_id: 'review-001',
    reasons: []
  });
});

function hostVerificationReceipt({
  liveHosts = ['opencode'],
  stateByHost = {},
  claimsByHost = {},
  releaseChannel = 'public_beta'
} = {}) {
  const required = ['codex', 'claude', 'grok', 'kimi', 'opencode', 'pi'];
  const artifacts = {
    claude: '1'.repeat(64),
    codex: '2'.repeat(64),
    portable: '3'.repeat(64),
    npm: '4'.repeat(64)
  };
  const candidateByHost = {
    codex: 'codex', claude: 'claude', grok: 'portable', kimi: 'npm',
    opencode: 'npm', pi: 'npm'
  };
  return {
    schema_version: 3,
    status: 'passed',
    release_channel: releaseChannel,
    policy: releaseChannel === 'stable'
      ? { minimum_live_verified_hosts: 6, required_live_host_ids: required }
      : { minimum_live_verified_hosts: 1, required_live_host_ids: [] },
    public_host_ids: required,
    all_claims_bounded: true,
    candidate_head: SHA_B,
    candidate_tree: TREE,
    dirty_tree_fingerprint: CLEAN_FINGERPRINT,
    artifact_digests: artifacts,
    hosts: required.map((id) => {
      const live = liveHosts.includes(id);
      const verificationState = stateByHost[id]
        || (live ? 'LIVE_VERIFIED' : 'STRUCTURALLY_VALIDATED');
      const capabilitiesEstablished = live
        ? ['package_installation', 'fresh_session_discovery', 'live_host_execution', 'model_backed_execution']
        : verificationState === 'INSTALLED_PACKAGE_VERIFIED'
          ? ['package_installation']
          : verificationState === 'STRUCTURALLY_VALIDATED'
            ? ['adapter_structure']
            : [];
      return {
        id,
        host_version: live ? 'fixture-1.0.0' : null,
        candidate: candidateByHost[id],
        archive: candidateByHost[id] === 'npm'
          ? 'zimster-0.7.0.tgz'
          : `zimster-0.7.0-${candidateByHost[id]}.zip`,
        archive_sha256: artifacts[candidateByHost[id]],
        candidate_commit: SHA_B,
        candidate_tree: TREE,
        verification_state: verificationState,
        commands_or_observations: live ? ['fixture live smoke'] : ['package structure inspected'],
        receipt_ids: [],
        authentication: { available: live, status: live ? 'available' : 'unavailable' },
        configuration: { available: live, status: live ? 'isolated' : 'unavailable' },
        model_backed_execution: live,
        capabilities_established: capabilitiesEstablished,
        capabilities_not_established: live ? [] : ['model_backed_execution'],
        public_claims: claimsByHost[id] || capabilitiesEstablished,
        installation_available: true,
        known_limitations: live ? [] : ['model-backed execution was not performed'],
        verified_at: '2026-08-04T12:00:00.000Z',
        expires_at: '2026-11-02T12:00:00.000Z'
      };
    }),
    generated_at: '2026-08-04T12:00:00.000Z'
  };
}

test('BETA-003 public beta accepts unavailable optional hosts with one exact-package live host', () => {
  const receipt = hostVerificationReceipt({
    stateByHost: { pi: 'UNAVAILABLE' }
  });
  assert.deepEqual(validateHostSmokeReceipt(receipt, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), receipt);
  const matrixResult = {
    ...COMPLETE_MATRIX,
    binding_requirement_ids: [...COMPLETE_MATRIX.binding_requirement_ids, 'BETA-003']
  };
  const betaReview = review({
    reviewed_requirement_ids: [...review().reviewed_requirement_ids, 'BETA-003'],
    intended_claims: ['Candidate claim.'],
    semantic_lenses: REQUIRED_LENSES
  });
  const base = {
    profile: 'standard', ownerVerified: true, reviewUnavailable: false,
    matrixResult, reviews: [betaReview], candidateHead: SHA_B, candidateTree: TREE,
    candidateBase: SHA_A, reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA, requiredLenses: REQUIRED_LENSES
  };
  const blocked = evaluateCandidateCompletion(base);
  assert.equal(blocked.state, COMPLETION_STATES.BLOCKED_BY_ENVIRONMENT);
  assert.match(blocked.reasons.join('\n'), /host verification|live host/i);
  assert.equal(evaluateCandidateCompletion({ ...base, hostSmokeReceipt: receipt }).state, COMPLETION_STATES.CANDIDATE_COMPLETE);
});

test('BETA-003 public beta requires one live host and bounds every public claim to receipt evidence', () => {
  const noLive = hostVerificationReceipt({ liveHosts: [] });
  assert.throws(() => validateHostSmokeReceipt(noLive, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /at least one|live/i);

  const falseLiveClaim = hostVerificationReceipt({
    claimsByHost: { claude: ['adapter_structure', 'model_backed_execution'] }
  });
  assert.throws(() => validateHostSmokeReceipt(falseLiveClaim, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /claim|model-backed|live/i);

  const installedPretendsLive = hostVerificationReceipt({
    stateByHost: { codex: 'INSTALLED_PACKAGE_VERIFIED' }
  });
  installedPretendsLive.hosts.find(({ id }) => id === 'codex').model_backed_execution = true;
  assert.throws(() => validateHostSmokeReceipt(installedPretendsLive, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /installed|model-backed|live/i);

  const structuralPretendsLive = hostVerificationReceipt();
  structuralPretendsLive.hosts.find(({ id }) => id === 'grok').verification_state = 'LIVE_VERIFIED';
  assert.throws(() => validateHostSmokeReceipt(structuralPretendsLive, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /live|model-backed|fresh-session/i);
});

test('BETA-003 stable profile may require stronger live coverage than public beta', () => {
  const betaCoverage = hostVerificationReceipt({ releaseChannel: 'stable' });
  assert.throws(() => validateHostSmokeReceipt(betaCoverage, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'stable'
  }), /stable|required live|six/i);

  const allLive = hostVerificationReceipt({
    releaseChannel: 'stable',
    liveHosts: ['codex', 'claude', 'grok', 'kimi', 'opencode', 'pi']
  });
  assert.doesNotThrow(() => validateHostSmokeReceipt(allLive, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'stable'
  }));

  const selfWeakened = hostVerificationReceipt();
  selfWeakened.release_channel = 'stable';
  selfWeakened.policy = { minimum_live_verified_hosts: 1, required_live_host_ids: [] };
  assert.throws(() => validateHostSmokeReceipt(selfWeakened, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'stable'
  }), /stable|policy|six|required live/i);
});

test('BETA-003 host verification remains bound to exact archive provenance', () => {
  const receipt = hostVerificationReceipt();
  assert.throws(() => validateHostSmokeReceipt({
    ...receipt,
    hosts: receipt.hosts.map((host) => host.id === 'pi'
      ? { ...host, archive_sha256: '9'.repeat(64) }
      : host)
  }, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /artifact|digest/i);
});

test('BETA-003 expired host evidence cannot satisfy the public-beta live floor', () => {
  const receipt = hostVerificationReceipt();
  const opencode = receipt.hosts.find(({ id }) => id === 'opencode');
  opencode.verified_at = '2025-10-01T00:00:00.000Z';
  opencode.expires_at = '2026-01-01T00:00:00.000Z';
  assert.throws(() => validateHostSmokeReceipt(receipt, {
    candidateHead: SHA_B,
    candidateTree: TREE,
    releaseChannel: 'public_beta'
  }), /expired|fresh/i);
});

test('missing or stale matrix proof blocks candidate completion', () => {
  const result = evaluateCandidateCompletion({
    profile: 'standard',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: {
      ...COMPLETE_MATRIX,
      valid: false,
      allowed_claims: [],
      unverified_obligations: ['MATRIX-001: evidence is stale']
    },
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: SHA_B,
    candidateTree: TREE,
    candidateBase: SHA_A,
    reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA,
    requiredLenses: REQUIRED_LENSES
  });
  assert.equal(result.state, COMPLETION_STATES.BLOCKED_BY_MISSING_EVIDENCE);
  assert.deepEqual(result.allowed_claims, []);
});

test('approval for an older head cannot approve a corrected candidate', () => {
  const result = evaluateCandidateCompletion({
    profile: 'standard',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: 'e'.repeat(40),
    candidateTree: TREE,
    candidateBase: SHA_A,
    reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA,
    requiredLenses: REQUIRED_LENSES
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /candidate head/i);
});

test('unavailable independent review produces an honest non-candidate state', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: true,
    matrixResult: COMPLETE_MATRIX,
    reviews: [],
    candidateHead: SHA_B,
    candidateTree: TREE,
    loadBearingReviewObligations: loadBearingObligations()
  });
  assert.equal(result.state, COMPLETION_STATES.OWNER_VERIFIED_REVIEW_UNAVAILABLE);
  assert.deepEqual(result.allowed_claims, ['Candidate claim.']);
});

test('a correction invalidates prior approval until the bounded recheck', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review()],
    candidateHead: SHA_B,
    candidateTree: TREE,
    loadBearingReviewObligations: loadBearingObligations(),
    correctionPending: true
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /correction.*recheck/i);
});

test('High-risk work fails closed when load-bearing review obligations are not recorded', () => {
  const result = evaluateCandidateCompletion({
    profile: 'high-risk',
    ownerVerified: true,
    reviewUnavailable: false,
    matrixResult: COMPLETE_MATRIX,
    reviews: [review({ intended_claims: ['Candidate claim.'] })],
    candidateHead: SHA_B,
    candidateTree: TREE,
    candidateBase: SHA_A,
    reviewPackageId: 'package-001',
    semanticContractSha256: CONTRACT_SHA,
    requiredLenses: REQUIRED_LENSES
  });
  assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
  assert.match(result.reasons.join('\n'), /load-bearing review obligations/i);
});

test('High-risk completion rejects boolean or stale load-bearing attestations', () => {
  for (const input of [
    { loadBearingReviewObligationsSatisfied: true },
    {
      loadBearingReviewObligations: loadBearingObligations({
        candidate_tree: 'f'.repeat(40)
      })
    },
    {
      loadBearingReviewObligations: loadBearingObligations({
        obligations: [{
          id: 'load-bearing-architecture',
          requirement_id: 'GATE-002',
          claim: 'High-risk load-bearing architecture is satisfied.',
          status: 'satisfied',
          evidence_refs: ['missing']
        }]
      })
    },
    {
      loadBearingReviewObligations: loadBearingObligations({
        obligations: [{
          id: 'load-bearing-architecture',
          requirement_id: 'GATE-001',
          claim: 'High-risk load-bearing architecture is satisfied.',
          status: 'satisfied',
          evidence_refs: ['evidence-load-bearing']
        }]
      })
    },
    {
      loadBearingReviewObligations: loadBearingObligations({
        obligations: [{
          id: 'load-bearing-architecture',
          requirement_id: 'GATE-002',
          claim: 'A different or narrower claim.',
          status: 'satisfied',
          evidence_refs: ['evidence-load-bearing']
        }]
      })
    }
  ]) {
    const result = evaluateCandidateCompletion({
      profile: 'high-risk',
      ...input,
      ownerVerified: true,
      matrixResult: COMPLETE_MATRIX,
      reviews: [review({
        intended_claims: ['Candidate claim.'],
        semantic_lenses: REQUIRED_LENSES
      })],
      candidateHead: SHA_B,
      candidateTree: TREE,
      candidateBase: SHA_A,
      reviewPackageId: 'package-001',
      semanticContractSha256: CONTRACT_SHA,
      requiredLenses: REQUIRED_LENSES
    });
    assert.equal(result.state, COMPLETION_STATES.REVIEW_PENDING);
    assert.match(result.reasons.join('\n'), /load-bearing review obligations/i);
  }
});

test('convention-heavy framework signals select the framework-defaults lens', () => {
  for (const signal of [
    'build-tool',
    'wrapper-adapter',
    'configuration-loader',
    'cli-framework',
    'router',
    'orm',
    'plugin-system',
    'inherited-project-configuration',
    'generated-user-managed-topology'
  ]) {
    assert.deepEqual(selectSemanticLenses([signal]), [
      'framework-defaults-and-conventions'
    ]);
  }
  assert.deepEqual(selectSemanticLenses(['documentation']), []);
});

test('shared adapter or provider branching selects the shared-control-flow lens', () => {
  for (const signal of [
    'shared-adapter-control-flow',
    'shared-provider-control-flow',
    'shared-platform-control-flow',
    'shared-backend-control-flow'
  ]) {
    assert.deepEqual(selectSemanticLenses([signal]), ['shared-control-flow']);
  }
  assert.deepEqual(selectSemanticLenses(['isolated-adapter']), []);
});
