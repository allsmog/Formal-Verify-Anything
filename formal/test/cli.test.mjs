import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/compiler.mjs';
import { validateProblem } from '../src/guard.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const problems = fileURLToPath(new URL('../../benchmarks/tier1.json', import.meta.url));
test('CLI refuses contradictory providers and invalid bounds before proving', async () => {
  for (const flags of [
    ['--proposer', 'unknown'], ['--proposer', 'codex', '--model-token-budget', '0'],
    ['--model', 'any'], ['--compiler', 'unknown'], ['--max-compiler-calls', '2'], ['--max-depth', '-1'],
    ['--proposer', 'command'], ['--proposer', 'codex', '--proposer-command', '["node"]'],
  ]) {
    const result = await runProcess(process.execPath, [cli, 'solve', problems, ...flags]);
    assert.equal(result.exitCode, 2, flags.join(' '));
    assert.equal(JSON.parse(result.stderr).status, 'ERROR');
  }
});
test('reviewed security definitions are admitted; proof and answer modules are refused', () => {
  const problem = { id: 'security_check', statement: 'theorem security_check : True' };
  assert.equal(validateProblem({ ...problem, imports: ['FormalVerify.Examples.TokenModel'] }).imports[0], 'FormalVerify.Examples.TokenModel');
  for (const module of ['FormalVerify.Examples.AtomicToken', 'MiniF2F.Test', 'FormalVerify.Examples.TokenModel.Proofs'])
    assert.throws(() => validateProblem({ ...problem, imports: [module] }), /imports|admitted/);
});
