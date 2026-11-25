#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHoldout, PROJECT_ROOT, sha256 } from './suite.mjs';
import { renderComparison, summarize } from './report.mjs';
import { retainCleanupOwners, settleInvocationCleanup } from './lifecycle.mjs';

export const SHARED_BUDGET = Object.freeze({
  maxCompilerCalls: 64,
  maxSteps: 64,
  maxProposalRounds: 3,
  maxDepth: 8,
  callTimeoutMs: 30_000,
  theoremTimeoutMs: 300_000,
  heartbeats: 200_000,
});
export const DEFAULT_MODEL_TOKEN_BUDGET = 50_000;

async function writeJson(filename, value) {
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
}

function gitValue(projectRoot, args) {
  try { return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function portable(value, projectRoot) {
  if (typeof value === 'string' && value.startsWith(`${projectRoot}${path.sep}`)) {
    return path.relative(projectRoot, value).split(path.sep).join('/');
  }
  if (Array.isArray(value)) return value.map((item) => portable(item, projectRoot));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item, projectRoot)]));
  return value;
}

async function executionHashes(projectRoot) {
  const files = [
    'formal/src/engine.mjs', 'formal/src/compiler.mjs', 'formal/src/guard.mjs',
    'formal/src/proposers.mjs', 'formal/src/codex-proposer.mjs', 'formal/src/lean-session.mjs',
    'formal/src/support.mjs', 'formal/src/process-group.mjs',
    'FormalVerify/Bridge.lean', 'FormalVerify/Worker.lean',
    '.lake/build/lib/lean/FormalVerify/Bridge.olean',
    'lean-toolchain', 'lakefile.toml', 'lake-manifest.json', 'formal/package-lock.json',
    'benchmarks/v2/run.mjs', 'benchmarks/v2/report.mjs', 'benchmarks/v2/suite.mjs', 'benchmarks/v2/lifecycle.mjs',
  ];
  const hashes = {};
  for (const file of files) {
    try { hashes[file] = sha256(await readFile(path.join(projectRoot, file))); }
    catch (error) { if (error.code === 'ENOENT') hashes[file] = null; else throw error; }
  }
  return hashes;
}

async function checkSolved(problem, result, projectRoot) {
  if (result.status !== 'SOLVED') return;
  if (!result.proofFile || result.statementHash !== problem.provenance.statementSha256 ||
      result.verification?.exitCode !== 0 || result.verification?.standaloneRecheck !== true) {
    throw new Error('SOLVED result lacks matching statement or standalone verification evidence.');
  }
  const source = await readFile(path.resolve(projectRoot, result.proofFile), 'utf8');
  if (sha256(source) !== result.verification.sourceHash || !source.includes(`${problem.statement} := by`) ||
      /\b(?:sorry|admit|sorryAx|axiom)\b/u.test(source)) {
    throw new Error('SOLVED proof artifact failed statement, hash, or prohibited-token validation.');
  }
}

export async function probeCodex(makeCodexProposer, options, modelTokenBudget, runDir) {
  const context = {
    protocol: 1,
    goal: { target: 'True', targetHead: 'True', hypotheses: [] },
    imports: [], feedback: [],
    budget: { compilerCallsRemaining: 64, maxDepth: 8, depth: 0,
      modelTokensRemaining: modelTokenBudget, remainingMs: 60_000 },
  };
  const startedAt = new Date().toISOString();
  await writeJson(path.join(runDir, 'provider-preflight-request.json'), {
    purpose: 'One actual provider availability check on a non-holdout True goal; not a benchmark theorem attempt.',
    startedAt, options, context,
  });
  let evidence;
  let proposer;
  try {
    proposer = await makeCodexProposer(options);
    const response = await proposer(context);
    if (!response || !Array.isArray(response.proposals)) throw new Error('Provider preflight returned no proposal array.');
    evidence = { method: 'codex', status: 'AVAILABLE', startedAt, finishedAt: new Date().toISOString(), response };
  } catch (error) {
    const recordedError = { message: String(error?.message ?? error).slice(0, 8000) };
    for (const key of ['code', 'retryable', 'status', 'metadata', 'usage', 'provider', 'modelTokens', 'modelTokensKnown', 'modelUsageComplete']) {
      if (error?.[key] !== undefined) recordedError[key] = error[key];
    }
    evidence = { method: 'codex', status: 'BLOCKED', startedAt, finishedAt: new Date().toISOString(), error: recordedError,
      consequence: 'No holdout theorem is submitted to this provider. Its unavailable invocations are not scored as theorem failures.' };
  }
  const cleanup = await settleInvocationCleanup(null, proposer);
  evidence.cleanupAssessment = { ...cleanup };
  if (cleanup.status === 'failed') {
    evidence.status = 'BLOCKED';
    evidence.error ??= { code: 'provider_cleanup', message: 'The preflight provider still owns resources whose cleanup failed.' };
    Object.defineProperty(evidence, 'cleanupOwner', { enumerable: false, value: cleanup });
  }
  await writeJson(path.join(runDir, 'provider-preflight.json'), evidence);
  return evidence;
}

export async function runComparison({ provider = 'both', compiler = 'worker', only = null,
  model = null, modelTokenBudget = DEFAULT_MODEL_TOKEN_BUDGET, projectRoot = PROJECT_ROOT } = {}) {
  if (!['both', 'deterministic', 'codex'].includes(provider)) throw new Error('Invalid provider selection.');
  if (!['worker', 'process'].includes(compiler)) throw new Error('Invalid compiler mode.');
  if (!Number.isSafeInteger(modelTokenBudget) || modelTokenBudget < 1) throw new Error('Model token budget must be a positive integer.');
  const frozen = await loadHoldout(projectRoot);
  const problems = frozen.problems.filter((problem) => !only || problem.id === only);
  if (!problems.length) throw new Error('No holdout theorem matches --only.');
  const methods = provider === 'both' ? ['deterministic-v2', 'codex'] : [provider === 'deterministic' ? 'deterministic-v2' : 'codex'];
  const { solveTheorem } = await import('../../formal/src/engine.mjs');
  const { deterministicProposer } = await import('../../formal/src/proposers.mjs');
  const makeCodexProposer = methods.includes('codex') ? (await import('../../formal/src/codex-proposer.mjs')).makeCodexProposer : null;
  const sessionFactory = compiler === 'worker' ? (await import('../../formal/src/lean-session.mjs')).createLeanSession : null;
  const plannedSchedule = problems.flatMap((problem) => {
    const index = frozen.problems.findIndex((entry) => entry.id === problem.id);
    const ordered = methods.length === 2 && index % 2 === 1 ? [...methods].reverse() : methods;
    return ordered.map((method) => ({ id: problem.id, method }));
  });
  const startedAt = new Date().toISOString();
  const canonicalComparisonRequested = !only && provider === 'both';
  const runId = `${startedAt.replaceAll(':', '-').replaceAll('.', '-')}-${canonicalComparisonRequested ? 'paired-24' : (only ?? provider)}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(projectRoot, 'benchmarks/v2/runs', runId);
  await mkdir(runDir, { recursive: true });
  const gitStatus = gitValue(projectRoot, ['status', '--porcelain']);
  const evaluation = {
    schemaVersion: 2, runId, canonicalComparisonRequested, canonicalComparison: false, startedAt, finishedAt: null,
    methods, selectedIds: problems.map((problem) => problem.id), plannedSchedule, schedule: [],
    sharedBudget: SHARED_BUDGET, modelTokenBudget, modelRequest: model, compilerMode: compiler,
    sourceCommit: frozen.suite.sourceCommit,
    selectionFrozenAt: frozen.selection.frozenAtUtc,
    inputHashes: frozen.inputHashes,
    importPolicy: frozen.importPolicy,
    environment: {
      gitCommit: gitValue(projectRoot, ['rev-parse', 'HEAD']),
      gitDirty: gitStatus === null ? null : Boolean(gitStatus),
      node: process.version, platform: `${process.platform}/${process.arch}`,
      leanToolchain: (await readFile(path.join(projectRoot, 'lean-toolchain'), 'utf8')).trim(),
      sourceAndArtifactHashes: await executionHashes(projectRoot),
    },
    results: [],
  };
  await writeJson(path.join(runDir, 'protocol.json'), evaluation);
  await writeJson(path.join(runDir, 'progress.json'), evaluation);
  const codexOptions = { command: 'codex', timeoutMs: 60_000, maxProposals: 6, ...(model ? { model } : {}) };
  evaluation.providerPreflight = methods.includes('codex')
    ? await probeCodex(makeCodexProposer, codexOptions, modelTokenBudget, runDir)
    : null;
  const cleanupOwners = [];
  if (evaluation.providerPreflight?.cleanupOwner) cleanupOwners.push(evaluation.providerPreflight.cleanupOwner);
  if (evaluation.providerPreflight?.cleanupAssessment?.status === 'failed') {
    evaluation.halt = { category: 'unresolved_cleanup', phase: 'provider_preflight',
      message: 'Scheduling stopped while the preflight provider still owns resources.' };
  }
  evaluation.providerAvailability = Object.fromEntries(methods.map((method) => [method,
    method === 'codex' ? evaluation.providerPreflight.status : 'AVAILABLE']));
  evaluation.schedule = plannedSchedule.filter((invocation) => evaluation.providerAvailability[invocation.method] === 'AVAILABLE');
  evaluation.blockedProviders = methods.filter((method) => evaluation.providerAvailability[method] !== 'AVAILABLE');
  evaluation.canonicalComparison = canonicalComparisonRequested && evaluation.blockedProviders.length === 0;
  evaluation.comparisonStatus = evaluation.blockedProviders.length ? 'BLOCKED_PROVIDER' : 'RUNNING';
  await writeJson(path.join(runDir, 'protocol.json'), evaluation);
  await writeJson(path.join(runDir, 'progress.json'), evaluation);
  if (evaluation.blockedProviders.length) process.stdout.write('Codex provider BLOCKED at preflight; no holdout model attempts will run. Available methods continue.\n');
  for (const [index, invocation] of evaluation.schedule.entries()) {
    if (evaluation.halt) break;
    const problem = problems.find((entry) => entry.id === invocation.id);
    const outputDir = path.join(runDir, invocation.method, problem.id);
    await mkdir(outputDir, { recursive: true });
    process.stdout.write(`[${index + 1}/${evaluation.schedule.length}] ${invocation.method}: ${problem.id}\n`);
    const invocationStart = performance.now();
    let result;
    let proposer;
    let invocationError;
    try {
      proposer = invocation.method === 'deterministic-v2'
        ? deterministicProposer
        : await makeCodexProposer(codexOptions);
      result = await solveTheorem(problem, {
        ...SHARED_BUDGET, maxModelTokens: invocation.method === 'codex' ? modelTokenBudget : 0,
        projectRoot, outputDir, proposer,
        ...(sessionFactory ? { explorationSessionFactory: sessionFactory } : {}),
      });
      await checkSolved(problem, result, projectRoot);
    } catch (error) {
      invocationError = error;
    }
    const cleanup = await settleInvocationCleanup(result, proposer);
    if (cleanup.status === 'failed') {
      cleanupOwners.push(cleanup);
      evaluation.halt = { category: 'unresolved_cleanup', phase: 'theorem', method: invocation.method, id: problem.id,
        message: 'Scheduling stopped while this invocation still owns resources.' };
    }
    if (invocationError) {
      result = {
        ...(result ?? {}), id: problem.id, status: 'ERROR', proofFile: null,
        statementHash: problem.provenance.statementSha256,
        metrics: result?.metrics ?? {
          compilerCalls: null, steps: null, maxDepth: null, elapsedMs: null,
          firstCandidateSolved: null, modelTokens: null, modelTokensKnown: 0, modelUsageComplete: false,
        },
        failure: { category: invocationError?.code ?? 'harness_exception', message: String(invocationError?.message ?? invocationError).slice(0, 4000) },
        tree: result?.tree ?? null, attempts: result?.attempts ?? [],
      };
    }
    const detailed = portable({
      ...result, id: problem.id, category: problem.category, method: invocation.method,
      provenance: problem.provenance, effectiveImports: problem.imports, effectiveOpens: problem.opens,
      cleanupAssessment: { ...cleanup },
      artifactDir: outputDir, invocationElapsedMs: Math.round(performance.now() - invocationStart),
    }, projectRoot);
    await writeJson(path.join(outputDir, 'result.json'), detailed);
    const { tree, attempts, proposerCalls, finalCandidates, ...summary } = detailed;
    evaluation.results.push({
      ...summary,
      detailsFile: `${detailed.artifactDir}/result.json`,
      attemptCount: attempts?.length ?? null,
      proposerRoundCount: proposerCalls?.length ?? null,
      finalCandidateCount: finalCandidates?.length ?? null,
      prunedBranches: tree?.branches?.filter((branch) => branch.status === 'PRUNED').length ?? null,
    });
    await writeJson(path.join(runDir, 'progress.json'), evaluation);
    process.stdout.write(`  ${detailed.status}; calls=${detailed.metrics?.compilerCalls ?? 'unknown'}; tokens=${detailed.metrics?.modelTokens ?? 'unknown'}\n`);
  }
  evaluation.finishedAt = new Date().toISOString();
  evaluation.executionComplete = !evaluation.halt && evaluation.results.length === evaluation.schedule.length;
  if (!evaluation.executionComplete) evaluation.canonicalComparison = false;
  evaluation.comparisonStatus = !evaluation.executionComplete ? 'INCOMPLETE' : evaluation.blockedProviders.length ? 'BLOCKED_PROVIDER' :
    evaluation.canonicalComparison ? 'COMPLETE' : 'DIAGNOSTIC';
  evaluation.environment.sourceAndArtifactHashesAfter = await executionHashes(projectRoot);
  evaluation.environment.executionBytesUnchanged = JSON.stringify(evaluation.environment.sourceAndArtifactHashesAfter) ===
    JSON.stringify(evaluation.environment.sourceAndArtifactHashes);
  const inputHashesAfter = Object.fromEntries(await Promise.all(Object.keys(evaluation.inputHashes).map(async (filename) =>
    [filename, sha256(await readFile(path.join(projectRoot, filename)))])));
  evaluation.protocolIntegrity = {
    executionBytesUnchanged: evaluation.environment.executionBytesUnchanged,
    inputBytesUnchanged: JSON.stringify(inputHashesAfter) === JSON.stringify(evaluation.inputHashes),
    inputHashesAfter,
    cleanupResolved: cleanupOwners.length === 0,
    executionComplete: evaluation.executionComplete,
  };
  evaluation.protocolIntegrity.valid = evaluation.protocolIntegrity.executionBytesUnchanged && evaluation.protocolIntegrity.inputBytesUnchanged &&
    evaluation.protocolIntegrity.cleanupResolved && evaluation.protocolIntegrity.executionComplete;
  await writeJson(path.join(runDir, 'results.json'), evaluation);
  await writeFile(path.join(runDir, 'results.md'), renderComparison(evaluation, runDir, projectRoot));
  if (canonicalComparisonRequested && evaluation.protocolIntegrity.valid) {
    const outputRoot = path.join(projectRoot, 'benchmarks/v2');
    await writeJson(path.join(outputRoot, 'results.json'), evaluation);
    await writeFile(path.join(outputRoot, 'results.md'), renderComparison(evaluation, outputRoot, projectRoot));
  }
  for (const method of methods) {
    if (evaluation.providerAvailability[method] === 'BLOCKED') {
      process.stdout.write(`${method}: BLOCKED; no theorem attempts or score\n`);
      continue;
    }
    const summary = summarize(evaluation.results.filter((row) => row.method === method));
    process.stdout.write(`${method}: ${summary.solved}/${summary.attempted}\n`);
  }
  process.stdout.write(`Report: ${path.join(runDir, 'results.md')}\n`);
  retainCleanupOwners(evaluation, cleanupOwners);
  return evaluation;
}

function parseArgs(args) {
  const options = {};
  const names = { '--provider': 'provider', '--compiler': 'compiler', '--only': 'only', '--model': 'model', '--max-model-tokens': 'modelTokenBudget' };
  for (let index = 0; index < args.length; index++) {
    if (['--help', '-h'].includes(args[index])) return { help: true };
    const key = names[args[index]];
    if (!key) throw new Error(`Unknown option: ${args[index]}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${args[index - 1]}`);
    options[key] = key === 'modelTokenBudget' ? Number(value) : value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: node benchmarks/v2/run.mjs [--provider both|deterministic|codex] [--compiler worker|process] [--only ID] [--model NAME] [--max-model-tokens N]\nOnly a full paired24 run writes benchmarks/v2/results.{md,json}; v1 artifacts are never written.\n');
    else {
      const result = await runComparison(options);
      if (!result.protocolIntegrity.valid) process.exitCode = 1;
      else if (result.blockedProviders.length) process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
