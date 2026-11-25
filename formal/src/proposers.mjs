import { runProcess } from './compiler.mjs';

const simpleName = /^[A-Za-z_][A-Za-z0-9_']*$/;

/** One fixed, statement-independent proposal policy. Only Lean judges success. */
export function deterministicProposer(context) {
  const goal = context.goal;
  const proposals = [];
  if (goal.targetHead === 'forall') proposals.push({ tactic: 'intro' });
  if (['And', 'Iff'].includes(goal.targetHead)) proposals.push({ tactic: 'constructor' });
  for (const h of goal.hypotheses) {
    if (['And', 'Or', 'Exists'].includes(h.typeHead) && simpleName.test(h.name))
      proposals.push({ tactic: `cases ${h.name}` });
  }
  // Check alternatives separately. This emits only retained tactics in the
  // final proof and avoids unused/unreachable-alternative linter warnings.
  for (const tactic of ['assumption', 'rfl', 'simp_all', 'omega', 'norm_num at *', 'ring', 'linarith', 'nlinarith',
    'positivity', 'norm_cast at *', 'field_simp at *', 'ring_nf at *', 'aesop'])
    proposals.push({ tactic });
  if (goal.targetHead === 'Or') proposals.push({ tactic: 'left' }, { tactic: 'right' });
  for (const h of goal.hypotheses) {
    if (['Nat', 'List'].includes(h.typeHead) && simpleName.test(h.name))
      proposals.push({ tactic: `induction ${h.name}` });
  }
  return { proposals, modelTokens: 0, policy: 'deterministic-v2' };
}
deterministicProposer.policy = 'deterministic-v2';

/** Optional trusted local JSON-lines proposer; command is an argv array, never a shell. */
export function commandProposer(argv, { timeoutMs = 30000, maxOutputBytes = 65536 } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string'))
    throw new TypeError('Proposer command must be a nonempty argv array');
  return async context => {
    const result = await runProcess(argv[0], argv.slice(1), {
      timeoutMs: Math.min(timeoutMs, context.budget.remainingMs), maxOutputBytes,
      input: JSON.stringify(context) + '\n',
    });
    if (result.exitCode !== 0 || result.timedOut || result.launchError || result.truncated)
      throw new Error('External proposer failed or exceeded its resource budget');
    const response = JSON.parse(result.stdout);
    if (!Array.isArray(response.proposals) || !Number.isSafeInteger(response.modelTokens) || response.modelTokens < 0)
      throw new Error('Proposer must return proposals and measured modelTokens');
    return response;
  };
}
