export async function authenticateFinalReviewAuthorization(runtime, state, options = {}) {
  void runtime;
  void options;
  if (state.status !== 'final_approved') return { type: 'not_final_approved' };
  const activeAttempts = state.attempts.filter(({ attempt_id }) =>
    !state.invalidated_attempt_ids.includes(attempt_id));
  const finalAttempt = activeAttempts.at(-1);
  if (finalAttempt?.verdict === 'approved') {
    return { type: 'review_verdict', attempt_id: finalAttempt.attempt_id };
  }
  throw new Error(
    'final approval requires an approved final-review verdict; caller-authored reviewer dispositions cannot authorize review'
  );
}
