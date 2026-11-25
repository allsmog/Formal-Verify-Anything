import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GuardError, sha256, validateProblem, validateTactic,
  renderStandalone, validateStandalone,
} from '../src/guard.mjs';
import {
  parseLeanOutput, observationFor, finalAcceptance, assessFinal, FINAL_VALIDATION_POLICY, runProcess,
} from '../src/compiler.mjs';
import { solveTheorem } from '../src/engine.mjs';

const problemInput = {
  id: 'security_example', statement: 'theorem security_example : True', imports: [],
};
const problem = () => validateProblem(problemInput);
const message = (data, severity = 'information') => JSON.stringify({
  severity, data, fileName: 'Candidate.lean',
  pos: { line: 7, column: 3 }, endPos: { line: 7, column: 9 },
});
const raw = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, timedOut: false, launchError: null,
  truncated: false, stderr: '', stdout, ...parseLeanOutput(stdout), ...extra,
});
const audit = (extra = {}) => ({
  version: 1, declaration: 'security_example', kind: 'theorem',
  kernel_checked: true, passed: true, axioms: [], type: 'True',
  universe_parameters: [], ...extra,
});
const audited = (extra = {}, processExtra = {}) => raw(
  message(`FVA_AUDIT:${JSON.stringify(audit(extra))}`), processExtra,
);
const goal = {
  id: 'goal', target: 'True', targetHead: 'True', targetArgs: [],
  hypotheses: [], universe_parameters: [], has_metavariables: false,
};
const observation = (extraLines = [], processExtra = {}) => raw([
  message(`FVA_STATE:${JSON.stringify({ version: 1, node_id: 'n0', goals: [goal] })}`),
  message('FVA_PROBE_STOP:n0', 'error'), ...extraLines,
].join('\n'), { exitCode: 1, ...processExtra });

test('ordinary proof bodies are admitted without substring false positives', () => {
  for (const body of [
    'exact True.intro', 'constructor\n· exact True.intro\n· exact True.intro',
    'have known : True := True.intro\nexact known', 'exact sorry_free_lemma',
  ]) assert.equal(validateTactic(body), body);
});

test('proof admission rejects placeholders, declarations, code execution, and lexical hiding', () => {
  const rejected = [
    'sorry', 'admit', 'exact sorryAx True false', 'axiom fake : False',
    'native_decide', 'exact ofReduceBool rfl', 'run_tac pure ()',
    'by_elab pure ()', 'elab "cheat" : tactic => pure ()',
    'set_option debug.skipKernelTC true in exact True.intro',
    'unsafe def forged : False := False', 'exact Lean.ofReduceBool rfl',
    'exact «sorry»', 'so/- hidden -/rry', '-- hidden\nexact True.intro',
    'exact True.intro\n#check True', 'exact "FVA_AUDIT:{}"',
    'fva_probe "n0"', 'fva_done "n0"', 'exact True.intro\u0000',
    'namespace Injected', 'import Evil', 'attribute [simp] bad',
  ];
  for (const candidate of rejected)
    assert.throws(() => validateTactic(candidate), GuardError, candidate);
});

test('theorem admission locks the name, original type, import list, and declaration boundary', () => {
  const rejected = [
    { ...problemInput, id: '../escape' },
    { ...problemInput, id: undefined, statement: 'theorem undefined : True' },
    { ...problemInput, statement: 'theorem another_name : True' },
    { ...problemInput, statement: 'theorem security_example : True := by trivial' },
    { ...problemInput, statement: 'theorem security_example : True\naxiom bad : False' },
    { ...problemInput, imports: ['MiniF2F.Test.mathd_algebra_107'] },
    { ...problemInput, imports: ['Mathlib\naxiom bad : False'] },
    { ...problemInput, imports: ['../Evil'] },
    { ...problemInput, opens: ['Nat\naxiom bad : False'] },
  ];
  for (const input of rejected)
    assert.throws(() => validateProblem(input), GuardError, JSON.stringify(input));
});

test('statement provenance hashes are enforced before proof search', () => {
  const correct = sha256(problemInput.statement);
  const wrong = '0'.repeat(64);
  for (const key of ['statementHash', 'statement_sha256']) {
    assert.equal(validateProblem({ ...problemInput, [key]: correct }).statementHash, correct);
    assert.throws(() => validateProblem({ ...problemInput, [key]: wrong }), GuardError);
  }
  for (const key of ['statement_sha256', 'statementSha256']) {
    assert.equal(validateProblem({ ...problemInput, provenance: { [key]: correct } }).statementHash, correct);
    assert.throws(() => validateProblem({ ...problemInput, provenance: { [key]: wrong } }), GuardError);
  }
  assert.throws(() => validateProblem({
    ...problemInput, statement: 'theorem security_example : False', statementHash: correct,
  }), GuardError);
});

test('all supplied hash aliases must be well-formed and agree, including lower-priority provenance', () => {
  const correct = sha256(problemInput.statement);
  const incorrect = '0'.repeat(64);
  const withClaim = (input, key, value) => key.startsWith('provenance.')
    ? { ...input, provenance: { ...input.provenance, [key.slice('provenance.'.length)]: value } }
    : { ...input, [key]: value };
  const aliases = ['statementHash', 'statement_sha256', 'provenance.statement_sha256', 'provenance.statementSha256'];
  const valid = aliases.reduce((input, key) => withClaim(input, key, correct), problemInput);
  assert.equal(validateProblem(valid).statementHash, correct);
  for (const alias of aliases) {
    for (const value of ['', null, undefined, false, 0, {}, [], 'f'.repeat(63), 'F'.repeat(64)])
      assert.throws(() => validateProblem(withClaim(valid, alias, value)), GuardError, alias);
    assert.throws(() => validateProblem(withClaim(valid, alias, incorrect)), GuardError, alias);
  }
  // This used to let a matching top-level alias override the original source
  // digest. The changed theorem must be rejected before any proof search.
  const changedStatement = 'theorem security_example : False';
  assert.throws(() => validateProblem({
    ...problemInput, statement: changedStatement, statementHash: sha256(changedStatement),
    provenance: { statementSha256: correct },
  }), GuardError);
  assert.throws(() => validateProblem({
    ...problemInput, statement: changedStatement, statementHash: '',
    provenance: { statementSha256: correct },
  }), GuardError);
});

test('standalone admission rejects statement changes, import changes, missing audit, and dedenting', () => {
  const accepted = renderStandalone(problem(), 'exact True.intro', 10000);
  const receipt = validateStandalone(problem(), accepted, 10000);
  assert.equal(receipt.sourceHash, sha256(accepted));
  assert.equal(receipt.statementHash, sha256(problemInput.statement));
  assert.equal(receipt.zeroPlaceholders, true);
  const mutations = [
    accepted.replace('theorem security_example : True', 'theorem security_example : False'),
    accepted.replace('import FormalVerify.Bridge', 'import Init'),
    accepted.replace('maxHeartbeats 10000', 'maxHeartbeats 0'),
    accepted.replace('#fva_audit security_example\n', ''),
    accepted.replace('  exact True.intro', 'exact True.intro'),
    accepted.replace('  exact True.intro', '  sorry'),
    accepted + '\naxiom added_after_audit : False\n',
  ];
  for (const source of mutations)
    assert.throws(() => validateStandalone(problem(), source, 10000), GuardError);
});

test('compiler diagnostics retain exact locations and classify substantive failures', () => {
  const parsed = parseLeanOutput([
    message('type mismatch: supplied term has type False but is expected to have type True', 'error'),
    message('unknown tactic madeUpTactic', 'error'),
    message('unsolved goals\nh : True\n⊢ False', 'error'),
    message('assumption tactic failed', 'error'),
    message('maximum number of heartbeats has been reached', 'error'),
  ].join('\n'));
  assert.deepEqual(parsed.diagnostics.map(d => d.category), [
    'type_mismatch', 'unknown_tactic_or_identifier', 'unsolved_goals',
    'missing_hypothesis_or_instance', 'heartbeat_limit',
  ]);
  assert.deepEqual(parsed.diagnostics[0].start, { line: 7, column: 3 });
  assert.deepEqual(parsed.diagnostics[0].end, { line: 7, column: 9 });
  assert.equal(parsed.diagnostics[0].file, 'Candidate.lean');
});

test('a later valid probe cannot conceal an earlier compiler error', () => {
  assert.equal(observationFor(observation(), 'n0', ['n0']).valid, true);
  const failed = observation([message('type mismatch: False versus True', 'error')]);
  assert.deepEqual(observationFor(failed, 'n0', ['n0']), {
    valid: false, failure: 'type_mismatch',
  });
});

test('probe acceptance requires one matching state and an exact generated sentinel', () => {
  const variants = [
    observation([], { exitCode: 0 }),
    observation([], { timedOut: true }),
    observation([], { truncated: true }),
    observation([], { launchError: 'missing toolchain' }),
    observation([], { states: [] }),
    observation([], { states: [{ node_id: 'another', goals: [goal] }] }),
    observation([], { states: [{ node_id: 'n0', goals: [goal] }, { node_id: 'n0', goals: [goal] }] }),
    observation([], { diagnostics: [{ severity: 'error', message: 'prefix FVA_PROBE_STOP:n0', category: 'probe_stop' }] }),
    observation([], { diagnostics: [{ severity: 'error', message: 'FVA_PROBE_STOP:unowned', category: 'probe_stop' }] }),
  ];
  for (const result of variants)
    assert.equal(observationFor(result, 'n0', ['n0']).valid, false);
});

test('exit zero alone never accepts a proof without the exact checked audit', () => {
  assert.equal(finalAcceptance(audited(), 'security_example'), true);
  assert.equal(finalAcceptance(raw(''), 'security_example'), false);
  for (const change of [
    { declaration: 'other_theorem' }, { kind: 'axiom' },
    { kernel_checked: false }, { passed: false },
    { kernel_checked: 'false' }, { passed: 'false' },
    { kernel_checked: 1 }, { passed: 1 }, { version: 2 },
    { axioms: ['sorryAx'] },
    { axioms: ['injected_assumption'] }, { axioms: null },
  ]) assert.equal(finalAcceptance(audited(change), 'security_example'), false);
  assert.equal(finalAcceptance(audited({ axioms: ['propext', 'Classical.choice', 'Quot.sound'] }), 'security_example'), true);
  for (const change of [
    { exitCode: 1 }, { timedOut: true }, { launchError: 'spawn error' },
    { truncated: true }, { unparsed: ['untrusted trailing output'] },
  ]) assert.equal(finalAcceptance(audited({}, change), 'security_example'), false);
  const duplicated = audited();
  duplicated.audits.push(audit());
  assert.equal(finalAcceptance(duplicated, 'security_example'), false);
});

test('a valid audit does not override warnings or earlier errors', () => {
  for (const severity of ['error', 'warning']) {
    const result = raw([
      message('declaration uses an admitted proof', severity),
      message(`FVA_AUDIT:${JSON.stringify(audit())}`),
    ].join('\n'));
    assert.equal(finalAcceptance(result, 'security_example'), false);
  }
});

test('only the exact unused-variable linter warning is benign and remains in the verification receipt', () => {
  const lint = 'unused variable `h₀`\n\nNote: This linter can be disabled with `set_option linter.unusedVariables false`';
  const withWarning = warning => raw([
    message(warning, 'warning'), message(`FVA_AUDIT:${JSON.stringify(audit())}`),
  ].join('\n'));
  const assessment = assessFinal(withWarning(lint), 'security_example');
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.policy, FINAL_VALIDATION_POLICY);
  assert.equal(assessment.permittedWarnings.length, 1);
  assert.equal(assessment.permittedWarnings[0].message, lint);
  assert.deepEqual(assessment.rejectedWarnings, []);
  for (const warning of [
    'unused variable `h₀`', `prefix ${lint}`, `${lint}\nunapproved additional warning`,
    'declaration uses sorry', 'this tactic is never executed', 'unknown compiler warning',
  ]) {
    const rejected = assessFinal(withWarning(warning), 'security_example');
    assert.equal(rejected.accepted, false, warning);
    assert.equal(rejected.reason, 'rejected_warning');
  }
  assert.equal(finalAcceptance(withWarning(lint), 'wrong_theorem'), false);
});

test('malformed JSON and malformed bridge payloads fail closed rather than throwing', () => {
  for (const line of ['null', '[]', '17', '{}', 'not-json']) {
    const result = raw(line);
    assert.ok(result.unparsed.length > 0, line);
    assert.equal(finalAcceptance(result, 'security_example'), false);
  }
  for (const payload of ['null', '[]', '17', '{}', '{']) {
    const invalidAudit = raw(message(`FVA_AUDIT:${payload}`));
    assert.equal(finalAcceptance(invalidAudit, 'security_example'), false, payload);
    const invalidState = raw([
      message(`FVA_STATE:${payload}`), message('FVA_PROBE_STOP:n0', 'error'),
    ].join('\n'), { exitCode: 1 });
    assert.equal(observationFor(invalidState, 'n0', ['n0']).valid, false, payload);
  }
});

test('timeout is preserved as a failure with output and process completion', { timeout: 5000 }, async () => {
  const result = await runProcess(process.execPath, ['-e',
    'process.stdout.write("started\\n"); setInterval(() => {}, 1000);',
  ], { timeoutMs: 300, maxOutputBytes: 1024 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /started/);
  assert.ok(result.elapsedMs < 3000);
});

test('bounded output preserves truncation as evidence, even after exit zero', async () => {
  const result = await runProcess(process.execPath, ['-e',
    'process.stdout.write("a".repeat(10000));',
  ], { timeoutMs: 2000, maxOutputBytes: 64 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.truncated, true);
  assert.match(result.stdout, /output omitted/);
  assert.ok(result.stdout.length < 256);
  assert.equal(finalAcceptance({ ...audited(), ...result }, 'security_example'), false);
});

async function modelBoundary(t, proposer, extra = {}) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'fva-provider-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  return solveTheorem(problemInput, { outputDir, proposer, maxModelTokens: 100,
    explorationCompiler: async ({ nodeId }) => raw([
      message(`FVA_STATE:${JSON.stringify({ version: 1, node_id: nodeId, goals: [goal] })}`),
      message(`FVA_PROBE_STOP:${nodeId}`, 'error'),
    ].join('\n'), { exitCode: 1, backend: 'boundary-fixture' }), ...extra });
}

test('proposer evidence retains actual provider identity, usage, metadata, and exact scoped request', async t => {
  const usage = { input_tokens: 11, cached_input_tokens: 4, output_tokens: 6 };
  const metadata = { model: 'test-model', cliVersion: 'test-version', requestDigest: 'provider-request' };
  const result = await modelBoundary(t, () => ({
    proposals: [], modelTokens: 17, policy: 'test-provider-v1', provider: 'test-provider', usage, metadata,
  }));
  assert.equal(result.metrics.modelTokens, 17);
  assert.equal(result.metrics.modelTokensKnown, 17);
  assert.equal(result.metrics.modelUsageComplete, true);
  assert.equal(result.policy, 'test-provider-v1');
  assert.equal(result.proposerCalls.length, 1);
  const call = result.proposerCalls[0];
  assert.equal(call.provider, 'test-provider');
  assert.deepEqual(call.usage, usage);
  assert.deepEqual(call.metadata, metadata);
  assert.match(call.evidenceId, /^ev_[a-f0-9]{64}$/);
  const request = JSON.parse(await readFile(call.contextFile, 'utf8'));
  assert.deepEqual(Object.keys(request).sort(), ['budget', 'feedback', 'goal', 'imports', 'protocol']);
  assert.equal(request.goal.target, 'True');
  assert.equal(result.attempts.length, 1);
});

test('provider failures preserve their precise category and known spend', async t => {
  const error = Object.assign(new Error('Provider rejected the request'), {
    code: 'provider_rate_limit', retryable: true, provider: 'test-provider', status: 429,
    modelTokens: 7, usage: { input_tokens: 5, output_tokens: 2 }, metadata: { requestId: 'request-1' },
  });
  const result = await modelBoundary(t, () => { throw error; });
  assert.equal(result.failure, 'provider_rate_limit');
  assert.equal(result.metrics.modelTokens, 7);
  assert.equal(result.proposerCalls[0].error.status, 429);
  assert.equal(result.proposerCalls[0].error.retryable, true);
  assert.equal(result.proposerCalls[0].metadata.requestId, 'request-1');
  assert.equal(result.proposerCalls[0].status, 'FAILED');
});

test('unknown provider spend remains unknown instead of becoming zero', async t => {
  const result = await modelBoundary(t, () => {
    throw Object.assign(new Error('Completed response has no usage record'), {
      code: 'provider_usage_unknown', retryable: false, provider: 'test-provider',
    });
  });
  assert.equal(result.failure, 'provider_usage_unknown');
  assert.equal(result.metrics.modelTokens, null);
  assert.equal(result.metrics.modelTokensKnown, 0);
  assert.equal(result.metrics.modelUsageComplete, false);
  assert.equal(result.proposerCalls[0].usageKnown, false);
  assert.equal(result.proposerCalls.length, 1);
});

test('malformed responses and exhausted token budgets retain already incurred usage', async t => {
  const malformed = await modelBoundary(t, () => ({ proposals: 'invalid', modelTokens: 9 }));
  assert.equal(malformed.failure, 'invalid_proposer_output');
  assert.equal(malformed.metrics.modelTokens, 9);
  const overBudget = await modelBoundary(t, () => ({ proposals: [], modelTokens: 12 }), { maxModelTokens: 10 });
  assert.equal(overBudget.failure, 'model_token_budget');
  assert.equal(overBudget.metrics.modelTokens, 12);
  assert.equal(overBudget.proposerCalls[0].tokenBudgetExceeded, true);
});

test('engine-created exploration sessions close after provider failure; borrowed sessions remain caller-owned', async t => {
  let ownedCloses = 0, borrowedCloses = 0;
  const compile = async ({ nodeId }) => raw([
    message(`FVA_STATE:${JSON.stringify({ version: 1, node_id: nodeId, goals: [goal] })}`),
    message(`FVA_PROBE_STOP:${nodeId}`, 'error'),
  ].join('\n'), { exitCode: 1 });
  const unavailable = () => { throw Object.assign(new Error('Unavailable'), {
    code: 'provider_unavailable', retryable: false, modelTokens: 0,
  }); };
  const owned = await modelBoundary(t, unavailable, {
    explorationCompiler: undefined,
    explorationSessionFactory: async () => ({ compile, close: async () => { ownedCloses++; } }),
  });
  assert.equal(ownedCloses, 1);
  assert.deepEqual(owned.exploration.cleanup, { ownership: 'engine', status: 'closed' });
  const borrowed = await modelBoundary(t, unavailable, {
    explorationCompiler: undefined,
    explorationSession: { compile, close: async () => { borrowedCloses++; } },
  });
  assert.equal(borrowedCloses, 0);
  assert.deepEqual(borrowed.exploration.cleanup, { ownership: 'caller', status: 'caller_owned' });
});

test('failed session cleanup retains its exact retry capability without serializing the resource owner', async t => {
  let closes = 0;
  const result = await modelBoundary(t, () => ({ proposals: [], modelTokens: 0 }), {
    explorationCompiler: undefined,
    explorationSessionFactory: async () => ({
      compile: async ({ nodeId }) => raw([
        message(`FVA_STATE:${JSON.stringify({ version: 1, node_id: nodeId, goals: [goal] })}`),
        message(`FVA_PROBE_STOP:${nodeId}`, 'error'),
      ].join('\n'), { exitCode: 1 }),
      close: async () => {
        closes++;
        if (closes === 1) throw Object.assign(new Error('Temporary cleanup failure'), { code: 'cleanup_unavailable' });
      },
    }),
  });
  assert.equal(result.exploration.cleanup.status, 'failed');
  assert.equal(result.exploration.cleanup.error.code, 'cleanup_unavailable');
  assert.equal(typeof result.retryExplorationCleanup, 'function');
  assert.equal(Object.keys(result).includes('retryExplorationCleanup'), false);
  assert.equal(JSON.stringify(result).includes('retryExplorationCleanup'), false);
  assert.equal((await result.retryExplorationCleanup()).status, 'closed');
  assert.equal(closes, 2);
  await result.retryExplorationCleanup();
  assert.equal(closes, 2);
});

test('failed worker suspension stops final admission and preserves cleanup ownership', async t => {
  let suspends = 0, closes = 0;
  const result = await modelBoundary(t, () => ({ proposals: [{ tactic: 'exact True.intro' }], modelTokens: 0 }), {
    explorationCompiler: undefined,
    explorationSessionFactory: async () => ({
      compile: async ({ nodeId, kind }) => raw([
        message(`FVA_STATE:${JSON.stringify({ version: 1, node_id: nodeId, goals: kind === 'state' ? [goal] : [] })}`),
        message(`FVA_PROBE_STOP:${nodeId}`, 'error'),
      ].join('\n'), { exitCode: 1 }),
      suspend: async () => {
        suspends++;
        throw Object.assign(new Error('Worker could not be released'), { code: 'worker_cleanup_failed' });
      },
      close: async () => { closes++; },
    }),
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure, 'exploration_suspend_failed');
  assert.equal(result.proofFile, null);
  assert.equal(suspends, 1);
  assert.equal(closes, 1);
  assert.equal(result.exploration.cleanup.status, 'closed');
  assert.equal(result.finalCandidates[0].explorationSuspension.error.code, 'worker_cleanup_failed');
  assert.ok(result.attempts.every(a => !['final', 'recheck'].includes(a.kind)));
  assert.equal(result.tree.branches[0].beforeHash, result.tree.branches[0].restoredHash);
});
