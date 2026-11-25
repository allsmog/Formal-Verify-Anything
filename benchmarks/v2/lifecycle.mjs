/** Resolve owned cleanup while the live, non-serializable owner capabilities exist. */
export async function settleInvocationCleanup(result, proposer) {
  const assessment = {
    status: 'closed',
    exploration: { ...(result?.exploration?.cleanup ?? { status: 'not_created', ownership: 'none' }), retryAttempted: false },
    provider: { status: 'not_applicable', retryAttempted: false, entries: [] },
  };
  if (result?.exploration?.cleanup?.status === 'failed') {
    assessment.exploration.retryAttempted = typeof result.retryExplorationCleanup === 'function';
    if (assessment.exploration.retryAttempted) {
      try {
        const retried = await result.retryExplorationCleanup();
        Object.assign(assessment.exploration, retried);
      } catch (error) {
        assessment.exploration.status = 'failed';
        assessment.exploration.error = { message: String(error?.message ?? error) };
      }
    }
  }
  if (typeof proposer?.retryCleanup === 'function') {
    assessment.provider.retryAttempted = true;
    try {
      const entries = await proposer.retryCleanup();
      if (!Array.isArray(entries) || entries.some((entry) => !['closed', 'failed'].includes(entry?.status))) {
        throw new Error('Provider cleanup returned an invalid ownership assessment.');
      }
      assessment.provider.entries = entries;
      assessment.provider.status = entries.some((entry) => entry.status === 'failed') ? 'failed' : 'closed';
    } catch (error) {
      assessment.provider.status = 'failed';
      assessment.provider.error = { message: String(error?.message ?? error) };
    }
  }
  if (['open', 'failed', 'caller_owned'].includes(assessment.exploration.status) ||
      assessment.provider.status === 'failed') assessment.status = 'failed';
  // The caller must retain this assessment while unresolved. Its retry closure
  // owns the exact result/proposer capabilities; JSON is only the evidence view.
  if (assessment.status === 'failed') Object.defineProperty(assessment, 'retry', {
    enumerable: false,
    value: () => settleInvocationCleanup(result, proposer),
  });
  return assessment;
}

/** Preserve unresolved owners on the returned run, without serializing handles. */
export function retainCleanupOwners(run, assessments) {
  const pending = assessments.filter((entry) => entry.status === 'failed');
  if (!pending.length) return;
  Object.defineProperty(run, 'retryCleanup', {
    enumerable: false,
    value: async () => {
      for (let index = 0; index < pending.length; index++) {
        if (typeof pending[index].retry === 'function') pending[index] = await pending[index].retry();
      }
      return pending.map((entry) => ({ ...entry }));
    },
  });
}
