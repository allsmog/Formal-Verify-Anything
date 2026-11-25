#!/usr/bin/env node
// A fixed complete workflow for measuring the exploration transport. It uses
// no model, decomposes two goals, includes two failed tactics per child, and
// retains both final CLI checks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveTheorem } from '../src/engine.mjs';
import { createLeanSession } from '../src/lean-session.mjs';

const [mode, output] = process.argv.slice(2);
if (!['process', 'worker'].includes(mode) || !output) {
  console.error('Usage: node formal/scripts/measure-worker.mjs process|worker OUTPUT_DIRECTORY');
  process.exitCode = 2;
} else {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const started = performance.now();
  const result = await solveTheorem({
    id: 'worker_measurement',
    imports: ['Mathlib.Data.Real.Basic', 'Mathlib.Tactic.NormNum', 'Mathlib.Tactic.Linarith.Frontend'],
    statement: 'theorem worker_measurement (a b : ℝ) (ha : 2 * a + 3 = 7) (hb : 3 * b - 1 = 8) : a = 2 ∧ b = 3',
  }, {
    projectRoot, outputDir: path.resolve(output), maxCompilerCalls: 16, maxSteps: 12,
    maxProposalRounds: 1, maxDepth: 2, callTimeoutMs: 30000,
    theoremTimeoutMs: 240000, maxModelTokens: 0, heartbeats: 200000,
    proposer: ({ goal }) => ({ proposals: goal.targetHead === 'And'
      ? [{ tactic: 'constructor' }]
      : [{ tactic: 'assumption' }, { tactic: 'rfl' }, { tactic: 'linarith' }], modelTokens: 0 }),
    ...(mode === 'worker' ? { explorationSessionFactory: createLeanSession } : {}),
  });
  console.log(JSON.stringify({ mode, status: result.status, failure: result.failure,
    elapsedMs: Math.round(performance.now() - started), metrics: result.metrics,
    proofFile: result.proofFile, verification: result.verification, cleanup: result.exploration.cleanup,
    attempts: result.attempts.map(({ kind, backend, backendMetadata, elapsedMs, exitCode, timedOut }) =>
      ({ kind, backend, backendMetadata, elapsedMs, exitCode, timedOut })),
  }, null, 2));
  if (result.status !== 'SOLVED') process.exitCode = 1;
}
