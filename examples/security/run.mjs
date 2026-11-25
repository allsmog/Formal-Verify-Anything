#!/usr/bin/env node
// This is an explicitly guided demonstration, not a general prover benchmark.
// Its fixed proof strategies were supplied during development and invoke no model.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveTheorem } from '../../formal/src/engine.mjs';
import { assessFinal } from '../../formal/src/compiler.mjs';
import { sha256, validateProblem, validateStandalone } from '../../formal/src/guard.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const exampleRoot = path.join(projectRoot, 'examples/security');
const policy = 'guided-token-demo-v1';
const budget = Object.freeze({
  maxCompilerCalls: 16, maxSteps: 8, maxProposalRounds: 1, maxDepth: 2,
  callTimeoutMs: 30000, theoremTimeoutMs: 180000, heartbeats: 200000, maxModelTokens: 0,
});
const induction = name => `induction ${name} with
| nil state =>
    cases state <;> rfl
| cons first _rest ih =>
    cases first <;> simp_all [successes, remaining]`;
const conservationType = `∀ (initialState finalState : TokenState) (events : List Outcome),
  Trace initialState events finalState →
    successes events + remaining finalState = remaining initialState`;

function guidedProposer(problemId) {
  const proposer = context => {
    let proposal;
    if (problemId === 'token_trace_conservation') {
      proposal = { kind: 'tactic', tactic: induction('execution') };
    } else if (context.budget.depth === 0) {
      proposal = { kind: 'have', name: 'conservation', type: conservationType };
    } else if (context.goal.hypotheses.some(h => h.name === 'conservation')) {
      proposal = { kind: 'tactic', tactic: `have conserved : successes outcomes + remaining final = 1 :=
  conservation .fresh final outcomes execution
omega` };
    } else {
      proposal = { kind: 'tactic', tactic: `intro initialState finalState events executionTrace
${induction('executionTrace')}` };
    }
    return { proposals: [proposal], modelTokens: 0, policy,
      provider: 'static-guided-policy', metadata: { manualGuidance: true, benchmarkEligible: false } };
  };
  proposer.policy = policy;
  return proposer;
}

async function executionHashes() {
  const files = [
    'examples/security/run.mjs', 'examples/security/token-conservation.json',
    'examples/security/token-at-most-once.json', 'FormalVerify/Examples/TokenModel.lean',
    '.lake/build/lib/lean/FormalVerify/Examples/TokenModel.olean',
    'FormalVerify/Bridge.lean', '.lake/build/lib/lean/FormalVerify/Bridge.olean',
    'formal/src/engine.mjs', 'formal/src/compiler.mjs', 'formal/src/guard.mjs',
    'formal/src/support.mjs', 'lean-toolchain', 'lakefile.toml', 'lake-manifest.json',
  ];
  return Object.fromEntries(await Promise.all(files.map(async file =>
    [file, sha256(await readFile(path.join(projectRoot, file)))])));
}

const relative = filename => filename
  ? path.relative(projectRoot, path.resolve(projectRoot, filename)).split(path.sep).join('/') : null;

async function verifyResult(problem, result) {
  if (result.status !== 'SOLVED') return;
  const source = await readFile(path.resolve(projectRoot, result.proofFile), 'utf8');
  const guard = validateStandalone(problem, source, budget.heartbeats);
  const checks = result.attempts.filter(attempt => ['final', 'recheck'].includes(attempt.kind));
  if (checks.length !== 2 || checks[0].kind !== 'final' || checks[1].kind !== 'recheck' ||
      !checks.every(check => check.backend === 'fresh-lean-cli' && assessFinal(check, problem.id).accepted) ||
      guard.sourceHash !== result.verification.sourceHash || result.metrics.modelTokens !== 0) {
    throw new Error(`The guided result lacks both fresh audited checks: ${problem.id}`);
  }
  if (problem.id === 'token_authorization_at_most_once') {
    const branch = result.tree.branches.find(branch => branch.proposal.kind === 'have' && branch.status === 'RETAINED');
    if (!branch || branch.children.length !== 2 || result.metrics.maxDepth !== 1)
      throw new Error('The at-most-once demonstration did not retain its recursive have branch.');
    const child = result.tree.nodes.find(node => node.id === branch.children[0] && node.status === 'VERIFIED_IN_FINAL_PROOF');
    const continuation = result.tree.nodes.find(node => node.id === branch.children[1] && node.status === 'VERIFIED_IN_FINAL_PROOF');
    if (!child || !continuation || child.goal.hypotheses.some(h => h.name === 'conservation') ||
        !continuation.goal.hypotheses.some(h => h.name === 'conservation'))
      throw new Error('The recursive lemma or continuation context was not isolated.');
  }
}

export async function runGuidedDemo(outputDir) {
  const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-guided-demo`;
  const directory = path.resolve(outputDir ?? path.join(exampleRoot, 'runs', runId));
  // Never replace an existing run or its proof evidence.
  await mkdir(directory, { recursive: false });
  const before = await executionHashes();
  const report = {
    schemaVersion: 1, runId, kind: 'guided-demo', policy, manualGuidance: true,
    benchmarkEligible: false, modelComparison: false, startedAt: new Date().toISOString(),
    scope: 'Fixed development-supplied proof strategies for two abstract atomic-token properties. This is not autonomous discovery, a public benchmark score, an LLM evaluation, or implementation verification.',
    compilerMode: 'process', budget, sourceAndArtifactHashes: before, results: [],
  };
  for (const filename of ['token-conservation.json', 'token-at-most-once.json']) {
    const problem = validateProblem(JSON.parse(await readFile(path.join(exampleRoot, filename), 'utf8')));
    if (problem.provenance.trustedModelSha256 !== before[problem.provenance.trustedModelPath])
      throw new Error(`The recorded trusted model differs from the source: ${problem.id}`);
    if (problem.imports.some(module => module.includes('AtomicToken') || module.startsWith('MiniF2F')))
      throw new Error('The guided task must import definitions, not completed proofs.');
    process.stdout.write(`Guided demonstration: ${problem.id}\n`);
    const theoremDir = path.join(directory, problem.id);
    const result = await solveTheorem(problem, {
      ...budget, projectRoot, outputDir: theoremDir, proposer: guidedProposer(problem.id),
    });
    await verifyResult(problem, result);
    report.results.push({
      id: result.id, status: result.status, failure: result.failure,
      statementHash: result.statementHash, metrics: result.metrics,
      proofFile: relative(result.proofFile), detailsFile: relative(path.join(theoremDir, 'result.json')),
      verification: result.verification,
      finalChecks: result.attempts.filter(attempt => ['final', 'recheck'].includes(attempt.kind)).map(attempt => ({
        kind: attempt.kind, exitCode: attempt.exitCode, backend: attempt.backend,
        evidenceId: attempt.evidenceId, ...assessFinal(attempt, result.id),
      })),
      retainedBranches: result.tree.branches.filter(branch => branch.status === 'RETAINED').map(branch => ({
        nodeId: branch.parent, proposal: branch.proposal, children: branch.children,
      })),
    });
    await writeFile(path.join(directory, 'progress.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`${result.id}: ${result.status}; calls=${result.metrics.compilerCalls}; depth=${result.metrics.maxDepth}; modelTokens=${result.metrics.modelTokens}\n`);
  }
  report.finishedAt = new Date().toISOString();
  report.sourceAndArtifactHashesAfter = await executionHashes();
  report.executionBytesUnchanged = JSON.stringify(before) === JSON.stringify(report.sourceAndArtifactHashesAfter);
  report.status = report.executionBytesUnchanged && report.results.every(row => row.status === 'SOLVED') ? 'VERIFIED_GUIDED_DEMO' : 'INCOMPLETE';
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = [
    '# Guided atomic-token proof demonstration', '',
    `Status: **${report.status}**. Policy: \`${policy}\`.`, '', report.scope, '',
    'The proposer is a hand-specified deterministic proof strategy. It makes zero runtime model calls. Each task starts with a separate proof tree and budget, imports only the token model and ordinary arithmetic tactics, and receives both fresh standalone final checks. The completed `AtomicToken.lean` proofs are not imported.', '',
    '| Theorem | Status | Compiler calls | Maximum depth | Model tokens | Evidence |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...report.results.map(row => `| ${row.id} | ${row.status} | ${row.metrics.compilerCalls} | ${row.metrics.maxDepth} | ${row.metrics.modelTokens} | [trace](${row.id}/result.json)${row.proofFile ? ` · [proof](${row.id}/${row.id}.lean)` : ''} |`), '',
    'The conservation task receives a direct induction strategy. The at-most-once task receives a structured `have conservation` proposal for a generalized conservation theorem. Its child introduces the generalized variables and proves the lemma by induction; its separate continuation applies the proved lemma to the original execution and finishes with `omega`. The trace verifies that the child cannot see its own unproved lemma, while the continuation can.', '',
    'This demonstration tests recursive composition and kernel admission using supplied guidance. It is excluded from all benchmark pass rates and model comparisons. The properties describe the abstract atomic state machine; they do not verify a concrete service, its linearizability, or network delivery.', '',
    `Recorded execution and input bytes unchanged: **${report.executionBytesUnchanged}**. Detailed source/artifact hashes and both final audit receipts are in [results.json](results.json).`, '',
  ];
  await writeFile(path.join(directory, 'results.md'), lines.join('\n'));
  process.stdout.write(`Report: ${path.join(directory, 'results.md')}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      process.stdout.write('Usage: node examples/security/run.mjs [--out NEW_DIRECTORY]\nA guided zero-model-token demo with fresh final checks; never a benchmark or model score.\n');
    } else {
      if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Expected --out NEW_DIRECTORY or no arguments');
      await mkdir(path.join(exampleRoot, 'runs'), { recursive: true });
      const result = await runGuidedDemo(args[1]);
      if (result.status !== 'VERIFIED_GUIDED_DEMO') process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
