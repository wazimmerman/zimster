import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

function safeId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

async function jsonl(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonlAtomically(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.temporary-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withRoutingStateLock(runtime, operation) {
  const lock = path.join(runtime, 'routing', 'state.lock');
  const owner = path.join(lock, 'owner.json');
  await mkdir(path.dirname(lock), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await mkdir(lock);
      await writeFile(owner, `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, { flag: 'wx' });
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const record = JSON.parse(await readFile(owner, 'utf8'));
        try {
          process.kill(record.pid, 0);
        } catch (processError) {
          if (processError.code === 'ESRCH') await rm(lock, { recursive: true, force: true });
          else throw processError;
        }
      } catch (ownerError) {
        if (ownerError.code !== 'ENOENT') throw ownerError;
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > 1000) {
            await rm(lock, { recursive: true, force: true });
          }
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error('routing state is busy; retry the operation');
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function files(runtime, proposalId = null) {
  const routing = path.join(runtime, 'routing');
  return {
    proposals: path.join(routing, 'proposals.jsonl'),
    dispatches: path.join(runtime, 'dispatches', 'dispatches.jsonl'),
    claims: path.join(routing, 'claims'),
    marker: proposalId ? path.join(routing, 'claims', `${safeId(proposalId, 'proposal id')}.lock`) : null
  };
}

async function readClaim(marker) {
  try { return JSON.parse(await readFile(marker, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function appendActiveProposal(runtime, proposal) {
  return withRoutingStateLock(runtime, async () => {
    const store = files(runtime);
    const proposals = await jsonl(store.proposals);
    if (proposals.some(({ id }) => id === proposal.id)) throw new Error(`proposal already exists: ${proposal.id}`);
    await writeJsonlAtomically(store.proposals, [...proposals, proposal]);
    return proposal;
  });
}

export async function supersedeActiveProposal(runtime, previousId, proposal, {
  now = new Date().toISOString()
} = {}) {
  safeId(previousId, 'proposal id');
  return withRoutingStateLock(runtime, async () => {
    const store = files(runtime, previousId);
    const proposals = await jsonl(store.proposals);
    const previous = proposals.find(({ id }) => id === previousId);
    if (!previous) throw new Error(`superseded proposal not found: ${previousId}`);
    if (previous.status !== 'active') throw new Error(`superseded proposal must be active; status is ${previous.status}`);
    if (previous.delegation_id !== proposal.delegation_id) throw new Error('superseded proposal belongs to a different delegation decision');
    await mkdir(store.claims, { recursive: true });
    const claim = {
      schema_version: 1,
      id: randomUUID(),
      proposal_id: previousId,
      purpose: 'supersession',
      status: 'reserved',
      replacement_proposal_id: proposal.id,
      claimed_at: now,
      completed_at: null
    };
    try {
      await writeFile(store.marker, `${JSON.stringify(claim, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`proposal ${previousId} is already claimed, consumed, or superseded`);
      throw error;
    }
    previous.status = 'invalidated';
    previous.superseded_by = proposal.id;
    previous.claim_id = claim.id;
    await writeJsonlAtomically(store.proposals, [...proposals, proposal]);
    claim.status = 'committed';
    claim.completed_at = now;
    await writeFile(store.marker, `${JSON.stringify(claim, null, 2)}\n`);
    return { previous, proposal, claim };
  });
}

export async function reserveProposalForDispatch(runtime, proposalId, {
  now = new Date().toISOString()
} = {}) {
  safeId(proposalId, 'proposal id');
  return withRoutingStateLock(runtime, async () => {
    const store = files(runtime, proposalId);
    const proposals = await jsonl(store.proposals);
    const proposal = proposals.find(({ id }) => id === proposalId);
    if (!proposal) throw new Error(`model proposal not found: ${proposalId}`);
    if (proposal.status !== 'active' || proposal.superseded_by) {
      throw new Error(`proposal is ${proposal.status}; proposals are single-use`);
    }
    await mkdir(store.claims, { recursive: true });
    const claim = {
      schema_version: 1,
      id: randomUUID(),
      proposal_id: proposalId,
      purpose: 'dispatch',
      status: 'reserved',
      claimed_at: now
    };
    try {
      await writeFile(store.marker, `${JSON.stringify(claim, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`proposal ${proposalId} is already claimed, consumed, or superseded`);
      throw error;
    }
    proposal.status = 'claimed';
    proposal.claim_id = claim.id;
    proposal.claimed_at = now;
    await writeJsonlAtomically(store.proposals, proposals);
    return { proposal, claim };
  });
}

export async function commitDispatchClaim(runtime, claimId, dispatch, {
  now = new Date().toISOString()
} = {}) {
  safeId(claimId, 'claim id');
  return withRoutingStateLock(runtime, async () => {
    const store = files(runtime, dispatch.proposal_id);
    const claim = await readClaim(store.marker);
    if (!claim || claim.id !== claimId || claim.purpose !== 'dispatch') {
      throw new Error('dispatch proposal claim is absent or does not match');
    }
    const proposals = await jsonl(store.proposals);
    const proposal = proposals.find(({ id }) => id === dispatch.proposal_id);
    if (!proposal || proposal.claim_id !== claimId) throw new Error('proposal claim linkage mismatch');
    const dispatches = await jsonl(store.dispatches);
    let recorded = dispatches.find(({ proposal_claim_id: id }) => id === claimId);
    if (!recorded) {
      if (dispatches.some(({ proposal_id: id }) => id === proposal.id)) {
        throw new Error(`proposal ${proposal.id} already has a dispatch`);
      }
      recorded = dispatch;
      await writeJsonlAtomically(store.dispatches, [...dispatches, recorded]);
    }
    proposal.status = 'consumed';
    proposal.consumed_by = recorded.id;
    proposal.consumed_at = now;
    delete proposal.claimed_at;
    await writeJsonlAtomically(store.proposals, proposals);
    await writeFile(store.marker, `${JSON.stringify({
      ...claim,
      status: 'consumed',
      dispatch_id: recorded.id,
      completed_at: now
    }, null, 2)}\n`);
    return recorded;
  });
}

export async function recoverProposalClaim(runtime, proposalId, claimId, {
  now = new Date().toISOString()
} = {}) {
  safeId(proposalId, 'proposal id');
  safeId(claimId, 'claim id');
  return withRoutingStateLock(runtime, async () => {
    const store = files(runtime, proposalId);
    const claim = await readClaim(store.marker);
    if (!claim || claim.id !== claimId || !['dispatch', 'supersession'].includes(claim.purpose)) {
      throw new Error('recoverable proposal claim was not found');
    }
    const proposals = await jsonl(store.proposals);
    const proposal = proposals.find(({ id }) => id === proposalId);
    if (!proposal) throw new Error('proposal claim linkage mismatch');
    if (claim.purpose === 'supersession') {
      const replacement = proposals.find(({ id }) => id === claim.replacement_proposal_id);
      if (
        proposal.status === 'invalidated'
        && proposal.claim_id === claimId
        && proposal.superseded_by === replacement?.id
      ) {
        await writeFile(store.marker, `${JSON.stringify({ ...claim, status: 'committed', completed_at: now }, null, 2)}\n`);
        return { status: 'superseded', proposal_id: proposalId, replacement_proposal_id: replacement.id };
      }
      if (proposal.status !== 'active' || replacement) {
        throw new Error('supersession claim is inconsistent and requires owner inspection');
      }
      await writeFile(store.marker, `${JSON.stringify({ ...claim, status: 'abandoned', abandoned_at: now }, null, 2)}\n`);
      await rm(store.marker);
      return { status: 'released', proposal_id: proposalId, claim_id: claimId };
    }
    if (proposal.status === 'active' && !proposal.claim_id) {
      const dispatches = await jsonl(store.dispatches);
      if (dispatches.some(({ proposal_claim_id: id }) => id === claimId)) {
        throw new Error('dispatch claim has a recorded dispatch but no proposal linkage; owner inspection is required');
      }
      await writeFile(store.marker, `${JSON.stringify({ ...claim, status: 'abandoned', abandoned_at: now }, null, 2)}\n`);
      await rm(store.marker);
      return { status: 'released', proposal_id: proposalId, claim_id: claimId };
    }
    if (proposal.claim_id !== claimId) throw new Error('proposal claim linkage mismatch');
    const dispatches = await jsonl(store.dispatches);
    const dispatched = dispatches.find(({ proposal_claim_id: id }) => id === claimId);
    if (dispatched) {
      proposal.status = 'consumed';
      proposal.consumed_by = dispatched.id;
      proposal.consumed_at ||= now;
      delete proposal.claimed_at;
      await writeJsonlAtomically(store.proposals, proposals);
      await writeFile(store.marker, `${JSON.stringify({ ...claim, status: 'consumed', dispatch_id: dispatched.id, completed_at: now }, null, 2)}\n`);
      return { status: 'consumed', proposal_id: proposalId, dispatch_id: dispatched.id };
    }
    if (proposal.status !== 'claimed') throw new Error(`proposal cannot be recovered from status ${proposal.status}`);
    proposal.status = 'active';
    delete proposal.claim_id;
    delete proposal.claimed_at;
    await writeJsonlAtomically(store.proposals, proposals);
    await writeFile(store.marker, `${JSON.stringify({ ...claim, status: 'abandoned', abandoned_at: now }, null, 2)}\n`);
    await rm(store.marker);
    return { status: 'released', proposal_id: proposalId, claim_id: claimId };
  });
}
