import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveTheorem } from '../src/engine.mjs';
import { compileLean, finalAcceptance, observationFor, parseLeanOutput, FINAL_VALIDATION_POLICY } from '../src/compiler.mjs';
import { sha256, validateProblem, renderStandalone, validateStandalone } from '../src/guard.mjs';

const enabled = process.env.FVA_INTEGRATION === '1';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const integration = { skip: !enabled, timeout: 120000 };
const respond = proposals => ({ proposals, modelTokens: 0 });

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-integration-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return directory;
}

async function solve(t, input, proposer, extra = {}) {
  const outputDir = await workspace(t);
  return solveTheorem({ imports: [], ...input }, {
    projectRoot, outputDir, proposer, callTimeoutMs: 20000,
    theoremTimeoutMs: 100000, maxCompilerCalls: 32, heartbeats: 100000,
    ...extra,
  });
}

function checkSolved(result) {
  assert.equal(result.status, 'SOLVED', JSON.stringify({
    failure: result.failure,
    attempts: result.attempts.map(a => ({ kind: a.kind, stderr: a.stderr, diagnostics: a.diagnostics })),
  }, null, 2));
  assert.equal(result.verification.exitCode, 0);
  assert.equal(result.verification.standaloneRecheck, true);
  assert.equal(result.verification.zeroPlaceholders, true);
  assert.equal(result.metrics.compilerCalls, result.attempts.length);
  assert.ok(result.attempts.filter(a => ['final', 'recheck'].includes(a.kind)).length >= 2);
  assert.ok(result.attempts.slice(-2).every(a => finalAcceptance(a, result.id)));
  assert.ok(result.attempts.slice(-2).every(a => a.backend === 'fresh-lean-cli'));
}

test('real Lean rejects failed tactics and restores a false have branch before proving the parent', integration, async t => {
  const result = await solve(t, {
    id: 'rollback_example', statement: 'theorem rollback_example : True',
  }, context => context.goal.targetHead === 'False'
    ? respond([{ tactic: 'assumption' }])
    : respond([
      { tactic: 'this_tactic_does_not_exist' },
      { tactic: 'skip' },
      { tactic: 'repeat skip' },
      { kind: 'have', name: 'impossible', type: 'False' },
      { tactic: 'exact True.intro' },
    ]));
  checkSolved(result);
  assert.equal(result.metrics.firstCandidateSolved, false);
  assert.ok(result.tree.branches.some(b => b.failure === 'unknown_tactic_or_identifier'));
  assert.ok(result.tree.branches.some(b => b.failure === 'no_progress'));
  assert.ok(result.tree.branches.some(b => b.failure === 'heartbeat_limit'));
  assert.ok(result.tree.branches.some(b => b.proposal.kind === 'have' && b.status === 'PRUNED'));
  for (const branch of result.tree.branches.filter(b => b.status === 'PRUNED'))
    assert.equal(branch.restoredHash, branch.beforeHash);
  const source = await readFile(result.proofFile, 'utf8');
  assert.match(source, /exact True\.intro/);
  assert.doesNotMatch(source, /impossible|this_tactic_does_not_exist|\bskip\b|\bsorry\b|\badmit\b/);
});

test('real Lean proves a have child and exposes that lemma only to its continuation', integration, async t => {
  const contexts = [];
  const result = await solve(t, {
    id: 'have_example', statement: 'theorem have_example : True ∧ True',
  }, context => {
    contexts.push(structuredClone(context));
    if (context.budget.depth === 0)
      return respond([{ kind: 'have', name: 'proved_child', type: 'True' }]);
    if (context.goal.hypotheses.some(h => h.name === 'proved_child'))
      return respond([{ tactic: 'exact And.intro proved_child proved_child' }]);
    return respond([{ tactic: 'exact True.intro' }]);
  });
  checkSolved(result);
  const children = contexts.filter(c => c.budget.depth === 1);
  assert.equal(children.length, 2);
  assert.equal(children[0].goal.hypotheses.some(h => h.name === 'proved_child'), false);
  assert.equal(children[1].goal.hypotheses.some(h => h.name === 'proved_child'), true);
  assert.equal(result.metrics.maxDepth, 1);
  assert.match(await readFile(result.proofFile, 'utf8'), /have proved_child : True := by/);
  assert.ok(result.tree.nodes.every(n => n.status === 'VERIFIED_IN_FINAL_PROOF'));
});

test('case children receive only their precise local proof context and no sibling or parent transcript', integration, async t => {
  const contexts = [];
  const result = await solve(t, {
    id: 'isolated_cases',
    statement: 'theorem isolated_cases (P Q : Prop) (h : P ∨ Q) : Q ∨ P',
  }, context => {
    contexts.push(structuredClone(context));
    if (context.budget.depth === 0) return respond([{ tactic: 'cases h' }]);
    const proof = context.goal.hypotheses.find(h => h.isProp && ['P', 'Q'].includes(h.type));
    assert.ok(proof, JSON.stringify(context.goal));
    // Case variables can have hygienic user names that are not addressable by
    // pasting their internal spelling. `assumption` resolves the local fact.
    return respond([{ tactic: `apply Or.${proof.type === 'P' ? 'inr' : 'inl'}\nassumption` }]);
  });
  checkSolved(result);
  const children = contexts.filter(c => c.budget.depth === 1);
  assert.equal(children.length, 2);
  assert.equal(children[0].goal.hypotheses.some(h => h.isProp && h.type === 'P'), true);
  assert.equal(children[0].goal.hypotheses.some(h => h.isProp && h.type === 'Q'), false);
  assert.equal(children[1].goal.hypotheses.some(h => h.isProp && h.type === 'Q'), true);
  assert.equal(children[1].goal.hypotheses.some(h => h.isProp && h.type === 'P'), false);
  for (const context of contexts) {
    assert.deepEqual(Object.keys(context).sort(), ['budget', 'feedback', 'goal', 'imports', 'protocol']);
    assert.equal('statement' in context, false);
    assert.equal('attempts' in context, false);
    assert.equal('siblings' in context, false);
    assert.deepEqual(context.imports, []);
    assert.ok(Array.isArray(context.feedback));
  }
});

test('a no-op after intro has the same state across attempt paths and creates no grandchild', integration, async t => {
  const result = await solve(t, {
    id: 'intro_no_progress', statement: 'theorem intro_no_progress : True → True',
  }, context => context.budget.depth === 0
    ? respond([{ tactic: 'intro' }])
    : respond([{ tactic: 'skip' }, { tactic: 'assumption' }]), {
    maxDepth: 3, maxCompilerCalls: 16,
  });
  checkSolved(result);
  const skipped = result.tree.branches.filter(b => b.proposal.tactic === 'skip');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].status, 'PRUNED');
  assert.equal(skipped[0].failure, 'no_progress');
  assert.deepEqual(skipped[0].children, []);
  assert.equal(skipped[0].restoredHash, skipped[0].beforeHash);
  assert.equal(result.metrics.maxDepth, 1);
  assert.ok(result.tree.nodes.every(n => n.depth <= 1));
  assert.doesNotMatch(await readFile(result.proofFile, 'utf8'), /\bskip\b/);
});

test('compiler budget is shared by recursive children and failed work is not refunded', integration, async t => {
  const result = await solve(t, {
    id: 'budget_example', statement: 'theorem budget_example : True ∧ True',
  }, context => context.budget.depth === 0
    ? respond([{ tactic: 'constructor' }])
    : respond([{ tactic: 'exact True.intro' }]), { maxCompilerCalls: 5 });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure, 'compiler_budget');
  assert.equal(result.metrics.compilerCalls, 3);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.proofFile, null);
  assert.equal(result.tree.finalPlan.kind, 'hole');
  assert.equal(result.tree.branches[0].restoredHash, result.tree.branches[0].beforeHash);
});

test('real Lean kernel audit rejects an admitted term and an injected axiom independently of source guard', integration, async t => {
  const directory = await workspace(t);
  const cases = [
    'theorem rejected_placeholder : True := by sorry\n#fva_audit rejected_placeholder\n',
    'axiom injected_assumption : False\ntheorem rejected_assumption : False := injected_assumption\n#fva_audit rejected_assumption\n',
  ];
  for (let i = 0; i < cases.length; i++) {
    const filename = path.join(directory, `rejected-${i}.lean`);
    await writeFile(filename, `import FormalVerify.Bridge\n${cases[i]}`);
    const compiled = await compileLean(projectRoot, filename, { timeoutMs: 20000 });
    assert.notEqual(compiled.exitCode, 0);
    assert.ok(compiled.diagnostics.some(d => d.message.includes('FVA_AUDIT_REJECTED')),
      JSON.stringify(compiled));
    assert.equal(finalAcceptance(compiled, i === 0 ? 'rejected_placeholder' : 'rejected_assumption'), false);
  }
});

test('real compiler errors remain disqualifying even when a later probe emits a valid state', integration, async t => {
  const directory = await workspace(t);
  const filename = path.join(directory, 'earlier-error.lean');
  await writeFile(filename, [
    'import FormalVerify.Bridge',
    'theorem earlier_error : True := by',
    '  have bad : False := by',
    '    exact True.intro',
    '  fva_probe "n0"', '',
  ].join('\n'));
  const compiled = await compileLean(projectRoot, filename, { timeoutMs: 20000 });
  assert.ok(compiled.states.some(s => s.node_id === 'n0'), JSON.stringify(compiled));
  assert.equal(observationFor(compiled, 'n0', ['n0']).valid, false);
  assert.ok(compiled.diagnostics.some(d => d.category === 'type_mismatch'));
});

test('saved proof revalidates independently and its original type cannot be replaced', integration, async t => {
  const statement = 'theorem immutable_statement (P : Prop) (h : P) : P';
  const input = {
    id: 'immutable_statement', statement, imports: [],
    provenance: { statementSha256: sha256(statement), source: 'integration fixture' },
  };
  const result = await solve(t, input, () => respond([{ tactic: 'exact h' }]));
  checkSolved(result);
  const source = await readFile(result.proofFile, 'utf8');
  const task = validateProblem(input);
  assert.equal(validateStandalone(task, source, 100000).statementHash, sha256(statement));
  const independentlyCompiled = await compileLean(projectRoot, result.proofFile, { timeoutMs: 20000 });
  assert.equal(finalAcceptance(independentlyCompiled, input.id), true);
  assert.throws(() => validateStandalone(task,
    source.replace(statement, 'theorem immutable_statement (P : Prop) (h : P) : True'),
    100000));
  assert.equal(result.metrics.firstCandidateSolved, true);
  assert.ok(renderStandalone(task, 'exact h', 100000).includes(statement));
});

// Deliberately untrustworthy exploration fixture. Real final/recheck commands
// must reject any false closure it reports, then let the search repair it.
function explorationObservation(nodeId, goals) {
  const stdout = [
    { severity: 'information', data: `FVA_STATE:${JSON.stringify({ version: 1, node_id: nodeId, goals })}` },
    { severity: 'error', data: `FVA_PROBE_STOP:${nodeId}` },
  ].map(x => JSON.stringify(x)).join('\n');
  return { exitCode: 1, signal: null, timedOut: false, launchError: null, truncated: false,
    elapsedMs: 0, stdout, stderr: '', backend: 'untrusted-test-exploration', ...parseLeanOutput(stdout) };
}
const scriptedGoal = (id, target = 'True', targetHead = 'True') => ({
  id, target, targetHead, hypotheses: [], targetArgs: [], universe_parameters: [], has_metavariables: false,
});

test('fresh final validation rejects a false exploratory closure, sends feedback, and resumes repair', integration, async t => {
  const requests = [], contexts = [];
  let closes = 0, suspends = 0, suspended = false;
  const result = await solve(t, {
    id: 'final_repair', statement: 'theorem final_repair : True',
  }, context => {
    contexts.push(structuredClone(context));
    return { proposals: [{ tactic: context.feedback.length ? 'exact True.intro' : 'exact False.elim' }],
      modelTokens: 3, policy: 'repair-fixture-v1', provider: 'fixture',
      usage: { input_tokens: 2, output_tokens: 1 }, metadata: { round: contexts.length } };
  }, {
    maxModelTokens: 20,
    explorationSessionFactory: async () => ({
      compile: async request => {
        suspended = false;
        requests.push(request);
        return explorationObservation(request.nodeId, request.kind === 'state' ? [scriptedGoal(request.nodeId)] : []);
      },
      suspend: async () => { assert.equal(suspended, false); suspended = true; suspends++; },
      close: async () => { closes++; },
    }),
  });
  checkSolved(result);
  assert.equal(result.engineVersion, 'fva-search-v2');
  assert.equal(result.validationPolicy, FINAL_VALIDATION_POLICY);
  assert.deepEqual(result.finalCandidates.map(c => c.status), ['REJECTED', 'ACCEPTED']);
  assert.equal(result.finalCandidates[0].reason, 'type_mismatch');
  assert.equal(contexts.length, 2);
  assert.ok(contexts[1].feedback.some(f => f.failure === 'final_type_mismatch'));
  assert.ok(contexts[1].feedback.some(f => f.diagnostics.some(d => d.category === 'type_mismatch')));
  assert.equal(result.metrics.modelTokens, 6);
  assert.equal(result.policy, 'repair-fixture-v1');
  assert.equal(result.proposerCalls[1].metadata.round, 2);
  assert.equal(closes, 1);
  assert.equal(suspends, 2);
  assert.ok(result.finalCandidates.every(c => c.explorationSuspension.status === 'SUSPENDED'));
  assert.equal(result.exploration.cleanup.status, 'closed');
  assert.ok(requests.every(r => ['state', 'candidate'].includes(r.kind)));
  assert.deepEqual(result.attempts.filter(a => ['final', 'recheck'].includes(a.kind)).map(a => a.kind), ['final', 'final', 'recheck']);
  const failedBranch = result.tree.branches.find(b => b.failure === 'final_type_mismatch');
  assert.equal(failedBranch.restoredHash, failedBranch.beforeHash);
  assert.doesNotMatch(await readFile(result.proofFile, 'utf8'), /False\.elim/);
});

test('a final rejection can backtrack to an earlier sibling and rebuild the complete proof', integration, async t => {
  const result = await solve(t, {
    id: 'sibling_repair', statement: 'theorem sibling_repair : True ∧ True',
  }, context => context.budget.depth === 0 ? respond([{ tactic: 'constructor' }])
    : context.goal.id === 'n1' ? respond([{ tactic: 'exact False.elim' }, { tactic: 'exact True.intro' }])
    : respond([{ tactic: 'exact True.intro' }]), {
    maxProposalRounds: 1,
    explorationCompiler: async request => {
      const goals = request.kind === 'state'
        ? [scriptedGoal(request.nodeId, request.nodeId === 'n0' ? 'And True True' : 'True', request.nodeId === 'n0' ? 'And' : 'True')]
        : request.nodeId === 'n0' ? [scriptedGoal('left'), scriptedGoal('right')] : [];
      return explorationObservation(request.nodeId, goals);
    },
  });
  checkSolved(result);
  assert.deepEqual(result.finalCandidates.map(c => c.status), ['REJECTED', 'ACCEPTED']);
  const rightVisits = result.tree.nodes.filter(n => n.id === 'n2');
  assert.equal(rightVisits.length, 2);
  assert.equal(rightVisits.filter(n => n.status === 'VERIFIED_IN_FINAL_PROOF').length, 1);
  assert.equal(rightVisits[0].status, 'EXHAUSTED');
  for (const branch of result.tree.branches.filter(b => b.status === 'PRUNED'))
    assert.equal(branch.restoredHash, branch.beforeHash);
  assert.doesNotMatch(await readFile(result.proofFile, 'utf8'), /False\.elim/);
});

test('rejected final candidates consume the shared budget and cannot bypass either fresh check', integration, async t => {
  const result = await solve(t, {
    id: 'final_budget', statement: 'theorem final_budget : True',
  }, () => respond([{ tactic: 'exact False.elim' }, { tactic: 'exact True.intro' }]), {
    maxCompilerCalls: 4,
    explorationCompiler: async request => explorationObservation(request.nodeId,
      request.kind === 'state' ? [scriptedGoal(request.nodeId)] : []),
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure, 'compiler_budget');
  assert.equal(result.metrics.compilerCalls, 3);
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].status, 'REJECTED');
  assert.equal(result.proofFile, null);
  assert.equal(result.tree.finalPlan.kind, 'hole');
  assert.equal(result.proposerCalls.length, 1);
});

test('real unused-hypothesis lint is preserved while the kernel-checked theorem is accepted', integration, async t => {
  const result = await solve(t, {
    id: 'benign_lint', statement: 'theorem benign_lint (unused : True) : True',
  }, () => respond([{ tactic: 'exact True.intro' }]));
  checkSolved(result);
  assert.equal(result.verification.policy, FINAL_VALIDATION_POLICY);
  assert.equal(result.verification.warnings.length, 1);
  assert.match(result.verification.warnings[0].message, /^unused variable `unused`/);
  assert.ok(result.attempts.slice(-2).every(a => a.diagnostics.some(d => d.severity === 'warning')));
});
