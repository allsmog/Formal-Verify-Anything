#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadHoldout, PROJECT_ROOT, sha256 } from './suite.mjs';
import { SHARED_BUDGET } from './run.mjs';

const expect = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, message) => expect(isDeepStrictEqual(actual, expected), message);
const keyOf = (entry) => `${entry.method}/${entry.id}`;
const hashPattern = /^[0-9a-f]{64}$/;
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;

/** Accounting checks do not execute Lean and are independently unit-testable. */
export function assertReportStructure(report, frozen) {
  expect(report?.schemaVersion === 2, 'Expected a v2 report.');
  expect(typeof report.runId === 'string' && /^[A-Za-z0-9_.-]+$/.test(report.runId), 'Invalid run identifier.');
  expect(report.canonicalComparisonRequested === true, 'A diagnostic or single-provider run is not the full holdout report.');
  expect(report.executionComplete === true && !report.halt && typeof report.finishedAt === 'string', 'The report is incomplete.');
  equal(report.methods, ['deterministic-v2', 'codex'], 'Both comparison methods must be declared.');
  equal(report.selectedIds, frozen.problems.map((problem) => problem.id), 'The selected IDs differ from the frozen 24-problem holdout.');
  equal(report.sharedBudget, SHARED_BUDGET, 'The shared compiler/search budget changed.');
  expect(Number.isSafeInteger(report.modelTokenBudget) && report.modelTokenBudget > 0, 'Missing model admission allowance.');
  expect(['worker', 'process'].includes(report.compilerMode), 'Unknown exploration compiler.');
  expect(report.sourceCommit === frozen.suite.sourceCommit && report.selectionFrozenAt === frozen.selection.frozenAtUtc,
    'Selection provenance differs from the frozen manifest.');
  equal(report.inputHashes, frozen.inputHashes, 'Frozen input hashes differ from the report.');
  equal(report.protocolIntegrity?.inputHashesAfter, frozen.inputHashes, 'Frozen inputs changed during execution.');
  for (const flag of ['valid', 'executionBytesUnchanged', 'inputBytesUnchanged', 'cleanupResolved', 'executionComplete']) {
    expect(report.protocolIntegrity?.[flag] === true, `Missing successful protocol integrity check: ${flag}.`);
  }
  const before = report.environment?.sourceAndArtifactHashes;
  expect(before && Object.keys(before).length > 0, 'Missing execution provenance hashes.');
  for (const filename of ['formal/src/engine.mjs', 'formal/src/compiler.mjs', 'formal/src/guard.mjs',
    'formal/src/proposers.mjs', 'formal/src/codex-proposer.mjs', 'formal/src/lean-session.mjs',
    'formal/src/support.mjs', 'FormalVerify/Bridge.lean', 'FormalVerify/Worker.lean',
    '.lake/build/lib/lean/FormalVerify/Bridge.olean', 'lean-toolchain', 'lakefile.toml', 'lake-manifest.json',
    'benchmarks/v2/run.mjs', 'benchmarks/v2/suite.mjs', 'benchmarks/v2/lifecycle.mjs']) {
    expect(hashPattern.test(before[filename] ?? ''), `Missing execution hash: ${filename}.`);
  }
  equal(report.environment?.sourceAndArtifactHashesAfter, before, 'Execution bytes changed during the run.');
  expect(report.environment.executionBytesUnchanged === true, 'Execution provenance is not complete.');
  expect(report.providerAvailability?.['deterministic-v2'] === 'AVAILABLE', 'The deterministic suite must be available.');
  const blocked = report.providerAvailability?.codex === 'BLOCKED';
  expect(blocked || report.providerAvailability?.codex === 'AVAILABLE', 'Codex availability must be AVAILABLE or BLOCKED.');
  expect(report.providerPreflight?.method === 'codex' && report.providerPreflight.status === (blocked ? 'BLOCKED' : 'AVAILABLE'),
    'A matching actual provider preflight is required.');
  expect(report.providerPreflight.cleanupAssessment?.status === 'closed', 'Preflight cleanup was not resolved.');
  if (blocked) {
    expect(report.providerPreflight.error && typeof report.providerPreflight.error.message === 'string', 'Blocked provider lacks error evidence.');
    expect(report.canonicalComparison === false && report.comparisonStatus === 'BLOCKED_PROVIDER', 'A blocked model provider cannot have a completed comparison score.');
    equal(report.blockedProviders, ['codex'], 'Blocked provider list is inconsistent.');
  } else {
    expect(report.canonicalComparison === true && report.comparisonStatus === 'COMPLETE', 'Available providers require a completed paired comparison.');
    expect(Array.isArray(report.providerPreflight.response?.proposals), 'Available provider lacks its actual preflight response.');
    equal(report.blockedProviders, [], 'Available provider was also recorded as blocked.');
  }
  const planned = frozen.problems.flatMap((problem, index) => (index % 2 === 0
    ? ['deterministic-v2', 'codex'] : ['codex', 'deterministic-v2']).map((method) => ({ id: problem.id, method })));
  equal(report.plannedSchedule, planned, 'The frozen paired order changed.');
  const expectedSchedule = planned.filter((entry) => !blocked || entry.method !== 'codex');
  equal(report.schedule, expectedSchedule, 'Available-provider scheduling is inconsistent.');
  expect(Array.isArray(report.results), 'Result rows are missing.');
  const expectedKeys = expectedSchedule.map(keyOf);
  const actualKeys = report.results.map(keyOf);
  expect(new Set(actualKeys).size === actualKeys.length, 'Duplicate theorem/provider result.');
  equal(actualKeys, expectedKeys, blocked
    ? 'Require exactly 24 deterministic results and zero blocked-provider theorem attempts.'
    : 'Require all 24 results exactly once for each provider.');
  const byId = new Map(frozen.problems.map((problem) => [problem.id, problem]));
  for (const row of report.results) {
    const problem = byId.get(row.id);
    expect(['SOLVED', 'FAILED', 'ERROR'].includes(row.status), `Invalid final status: ${keyOf(row)}.`);
    expect(row.category === problem.category, `Stratum changed: ${row.id}.`);
    expect(row.statementHash === problem.provenance.statementSha256, `Statement hash changed: ${row.id}.`);
    equal(row.provenance, problem.provenance, `Provenance changed: ${row.id}.`);
    equal(row.effectiveImports, problem.imports, `Execution imports changed: ${row.id}.`);
    equal(row.effectiveOpens, problem.opens, `Namespace openings changed: ${row.id}.`);
    expect(row.cleanupAssessment?.status === 'closed', `Unresolved cleanup: ${keyOf(row)}.`);
    if (row.status === 'SOLVED') {
      expect(row.proofFile && row.verification?.exitCode === 0 && row.verification.standaloneRecheck === true,
        `SOLVED lacks final verification: ${keyOf(row)}.`);
    }
  }
  return { selected: frozen.problems.length, deterministicAttempts: 24, codexAttempts: blocked ? 0 : 24,
    codexStatus: blocked ? 'BLOCKED_NO_SCORE' : 'EVALUATED', solved: report.results.filter((row) => row.status === 'SOLVED').length };
}

function localArtifact(projectRoot, filename, requiredPrefix) {
  expect(typeof filename === 'string' && !path.isAbsolute(filename), 'Artifacts must use repository-relative paths.');
  const absolute = path.resolve(projectRoot, filename);
  const relative = path.relative(projectRoot, absolute).split(path.sep).join('/');
  expect(relative === filename && !relative.startsWith('../') && relative.startsWith(requiredPrefix), `Artifact escapes its run: ${filename}.`);
  return absolute;
}

async function assertArtifacts(report, frozen, projectRoot, modules) {
  const { canonicalDigest, validateProblem, sourcePrefix, validateStandalone, assessFinal } = modules;
  const runPrefix = `benchmarks/v2/runs/${report.runId}/`;
  const diskReport = JSON.parse(await readFile(path.join(projectRoot, runPrefix, 'results.json'), 'utf8'));
  equal(diskReport, report, 'Promoted report and retained run report differ.');
  const preflight = JSON.parse(await readFile(path.join(projectRoot, runPrefix, 'provider-preflight.json'), 'utf8'));
  equal(preflight, report.providerPreflight, 'Provider preflight file differs from the report.');
  const request = JSON.parse(await readFile(path.join(projectRoot, runPrefix, 'provider-preflight-request.json'), 'utf8'));
  expect(request.context?.goal?.target === 'True' && request.context?.goal?.hypotheses?.length === 0,
    'Provider availability was not checked on the declared non-holdout True goal.');
  if (report.providerAvailability.codex === 'BLOCKED') {
    try {
      const entries = await readdir(path.join(projectRoot, runPrefix, 'codex'));
      expect(entries.length === 0, 'Blocked provider has unexpected theorem attempt artifacts.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const proofChecks = [];
  const byId = new Map(frozen.problems.map((problem) => [problem.id, validateProblem(problem)]));
  let compilerCalls = 0, prunedBranches = 0;
  for (const row of report.results) {
    const problem = byId.get(row.id);
    const invocationPrefix = `${runPrefix}${row.method}/${row.id}/`;
    equal(row.detailsFile, `${invocationPrefix}result.json`, `Incorrect details link: ${keyOf(row)}.`);
    const details = JSON.parse(await readFile(localArtifact(projectRoot, row.detailsFile, invocationPrefix), 'utf8'));
    const { tree, attempts, proposerCalls, finalCandidates, ...summary } = details;
    const { detailsFile: _detailsFile, attemptCount, proposerRoundCount, finalCandidateCount, prunedBranches: pruned, ...recordedSummary } = row;
    equal(summary, recordedSummary, `Summary/detail divergence: ${keyOf(row)}.`);
    expect(Array.isArray(attempts) && attempts.length === attemptCount, `Compiler attempt count mismatch: ${keyOf(row)}.`);
    expect(details.metrics?.compilerCalls === attempts.length, `Compiler call accounting mismatch: ${keyOf(row)}.`);
    expect(nonnegative(details.metrics.steps) && details.metrics.steps <= report.sharedBudget.maxSteps, 'Invalid search step count.');
    expect(nonnegative(details.metrics.maxDepth) && details.metrics.maxDepth <= report.sharedBudget.maxDepth, 'Invalid recursion depth.');
    expect(attempts.length <= report.sharedBudget.maxCompilerCalls, 'Compiler budget exceeded.');
    equal(details.budget, { ...report.sharedBudget, maxModelTokens: row.method === 'codex' ? report.modelTokenBudget : 0 },
      `Per-theorem budget changed: ${keyOf(row)}.`);
    expect(Array.isArray(tree?.branches) && tree.branches.length === details.metrics.steps, 'Branch/step accounting mismatch.');
    expect(Array.isArray(tree.nodes) && tree.nodes.every((node, index) => node.visit === index), 'Node visits are not uniquely sequenced.');
    const pruneList = tree.branches.filter((branch) => branch.status === 'PRUNED');
    expect(pruneList.length === pruned, 'Pruned branch count mismatch.');
    for (const branch of tree.branches) {
      expect(['PRUNED', 'RETAINED'].includes(branch.status), 'A branch has no final disposition.');
      expect(hashPattern.test(branch.beforeHash ?? ''), 'A branch lacks its parent-state hash.');
      if (branch.status === 'PRUNED') expect(branch.beforeHash === branch.restoredHash, 'A pruned branch did not restore its exact parent.');
    }
    expect(Array.isArray(proposerCalls) && proposerCalls.length === proposerRoundCount && proposerCalls.length === details.metrics.proposerCalls,
      'Proposer round accounting mismatch.');
    let knownTokens = 0;
    let usageComplete = true;
    for (const call of proposerCalls) {
      if (call.usageKnown) { expect(nonnegative(call.modelTokens), 'Invalid observed token count.'); knownTokens += call.modelTokens; }
      else { expect(call.modelTokens === null, 'Unknown model use must remain null.'); usageComplete = false; }
      const context = JSON.parse(await readFile(localArtifact(projectRoot, call.contextFile, `${invocationPrefix}proposals/`), 'utf8'));
      expect(canonicalDigest(context) === call.requestDigest, 'Proposer context hash mismatch.');
      const contextResult = call.contextFile.replace(/-context\.json$/, '-result.json');
      const saved = JSON.parse(await readFile(localArtifact(projectRoot, contextResult, `${invocationPrefix}proposals/`), 'utf8'));
      expect(saved.evidenceId === call.evidenceId && saved.requestDigest === call.requestDigest && saved.modelTokens === call.modelTokens,
        'Proposer evidence differs from its detailed result.');
    }
    expect(details.metrics.modelTokensKnown === knownTokens && details.metrics.modelUsageComplete === usageComplete &&
      details.metrics.modelTokens === (usageComplete ? knownTokens : null), 'Provider token totals are inconsistent.');
    if (row.method === 'deterministic-v2') expect(knownTokens === 0 && usageComplete, 'Deterministic run contains model token use.');
    const attemptsByEvidence = new Map();
    for (const [index, attempt] of attempts.entries()) {
      expect(attempt.sequence === index + 1, 'Compiler attempt sequence is incomplete.');
      const sourceFile = localArtifact(projectRoot, attempt.sourceFile, `${invocationPrefix}attempts/`);
      const source = await readFile(sourceFile, 'utf8');
      expect(source.startsWith(sourcePrefix(problem, report.sharedBudget.heartbeats)), 'A compiler attempt changed the theorem scaffold.');
      expect(attempt.sourceHash === canonicalDigest(source), 'Compiler attempt source hash mismatch.');
      expect(attempt.evidenceId === `ev_${canonicalDigest({ source, exitCode: attempt.exitCode,
        stdout: attempt.stdout, stderr: attempt.stderr, timedOut: attempt.timedOut })}`, 'Compiler receipt digest mismatch.');
      const saved = JSON.parse(await readFile(sourceFile.replace(/\.lean$/, '.json'), 'utf8'));
      for (const field of ['sequence', 'kind', 'nodeId', 'sourceHash', 'evidenceId', 'stdout', 'stderr', 'exitCode', 'timedOut', 'backend']) {
        equal(saved[field], attempt[field], `Compiler receipt field changed: ${field}.`);
      }
      attemptsByEvidence.set(attempt.evidenceId, { attempt, source });
    }
    expect(Array.isArray(finalCandidates) && finalCandidates.length === finalCandidateCount && finalCandidates.length === details.metrics.finalCandidates,
      'Final candidate accounting mismatch.');
    const accepted = finalCandidates.filter((candidate) => candidate.status === 'ACCEPTED');
    expect(accepted.length === (row.status === 'SOLVED' ? 1 : 0), 'Accepted final candidates disagree with the theorem status.');
    if (row.status === 'SOLVED') {
      const filename = localArtifact(projectRoot, row.proofFile, invocationPrefix);
      const source = await readFile(filename, 'utf8');
      const guarded = validateStandalone(problem, source, report.sharedBudget.heartbeats);
      expect(guarded.sourceHash === row.verification.sourceHash && guarded.statementHash === row.statementHash,
        'The standalone proof bytes or statement hash changed.');
      equal(row.verification.compileEvidence, accepted[0].evidenceIds, 'Accepted proof and final receipts differ.');
      expect(accepted[0].evidenceIds.length === 2, 'Accepted proof must have two independent final receipts.');
      for (const [index, evidenceId] of accepted[0].evidenceIds.entries()) {
        const receipt = attemptsByEvidence.get(evidenceId);
        expect(receipt && receipt.attempt.kind === ['final', 'recheck'][index] && receipt.attempt.backend === 'fresh-lean-cli',
          'A final receipt is missing or used the exploration worker.');
        expect(receipt.source === source && assessFinal(receipt.attempt, problem.id).accepted,
          'Recorded final receipt does not accept the exact proof.');
      }
      proofChecks.push({ id: row.id, method: row.method, proofFile: row.proofFile, problem, ...guarded });
    } else expect(!row.proofFile, 'An unsolved theorem has an accepted proof file.');
    compilerCalls += attempts.length;
    prunedBranches += pruneList.length;
  }
  return { proofChecks, compilerCalls, prunedBranches };
}

export async function verifyResults({ projectRoot = PROJECT_ROOT, reportFile = 'benchmarks/v2/results.json',
  structuralOnly = false, outputFile = null, lake = 'lake', timeoutMs = 30_000 } = {}) {
  const reportPath = path.resolve(projectRoot, reportFile);
  // Missing reports are an error, including in CI; never silently skip verification.
  const reportBytes = await readFile(reportPath);
  const report = JSON.parse(reportBytes);
  const frozen = await loadHoldout(projectRoot);
  const accounting = assertReportStructure(report, frozen);
  const [{ canonicalDigest }, guard, compiler] = await Promise.all([
    import('../../formal/src/support.mjs'), import('../../formal/src/guard.mjs'), import('../../formal/src/compiler.mjs'),
  ]);
  const artifacts = await assertArtifacts(report, frozen, projectRoot, { canonicalDigest, ...guard, ...compiler });
  const capturedAt = new Date().toISOString();
  const currentHashes = {};
  for (const filename of Object.keys(report.environment.sourceAndArtifactHashes)) {
    try { currentHashes[filename] = sha256(await readFile(path.join(projectRoot, filename))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; currentHashes[filename] = null; }
  }
  const executionByteDifferences = Object.entries(currentHashes).filter(([filename, hash]) =>
    hash !== report.environment.sourceAndArtifactHashes[filename]).map(([filename, currentSha256]) =>
    ({ filename, recordedSha256: report.environment.sourceAndArtifactHashes[filename], currentSha256 }));
  const checks = [];
  for (const item of artifacts.proofChecks) {
    const { problem: _problem, ...proof } = item;
    if (structuralOnly) checks.push({ ...proof, status: 'RECORDED_EVIDENCE_CHECKED', independentlyCompiled: false });
    else {
      // item.proofFile is repository-relative (checked by localArtifact), so the
      // receipt's compiler output never records where the checkout lives.
      const result = await compiler.compileLean(projectRoot, item.proofFile, { lake, timeoutMs });
      const assessment = compiler.assessFinal(result, item.id);
      const after = await readFile(path.resolve(projectRoot, item.proofFile), 'utf8');
      const sourceUnchanged = sha256(after) === item.sourceHash;
      checks.push({ ...proof, status: assessment.accepted && sourceUnchanged ? 'VERIFIED' : 'REJECTED',
        independentlyCompiled: true, sourceUnchanged, assessment, compiler: result });
      process.stdout.write(`${proof.method}/${proof.id}: ${checks.at(-1).status}\n`);
    }
  }
  const receipt = {
    schemaVersion: 1, capturedAt, completedAt: new Date().toISOString(), reportFile: path.relative(projectRoot, reportPath),
    reportSha256: sha256(reportBytes), runId: report.runId,
    status: structuralOnly ? 'STRUCTURAL_ONLY' : checks.every((check) => check.status === 'VERIFIED') ? 'VERIFIED' : 'REJECTED',
    scope: structuralOnly ? 'Frozen selection, complete denominator, artifact hashes, recorded receipts, branch restoration, and usage accounting. No fresh proof compilation.'
      : 'Complete accounting and artifact integrity plus one new standalone Lean process for every recorded SOLVED proof. Failed theorems are neither retried nor rescored.',
    accounting: { ...accounting, compilerCalls: artifacts.compilerCalls, prunedBranches: artifacts.prunedBranches },
    validationPolicy: compiler.FINAL_VALIDATION_POLICY,
    inputHashes: frozen.inputHashes, currentExecutionHashes: currentHashes, executionByteDifferences,
    provenanceLimit: 'Current hashes identify the recheck environment. Differences, including rebuilt binaries, are disclosed rather than represented as original execution equivalence. This is not a signed attestation.',
    checks,
  };
  const destination = outputFile ? path.resolve(projectRoot, outputFile) : path.join(projectRoot, 'benchmarks/v2/rechecks',
    `${capturedAt.replaceAll(':', '-').replaceAll('.', '-')}-${structuralOnly ? 'structural' : 'standalone'}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${receipt.status}: ${accounting.deterministicAttempts} deterministic, ${accounting.codexAttempts} Codex, ${checks.length} accepted proof artifacts.\nReceipt: ${destination}\n`);
  return receipt;
}

function parseArgs(args) {
  const options = {};
  const names = { '--report': 'reportFile', '--output': 'outputFile', '--lake': 'lake', '--timeout-ms': 'timeoutMs' };
  for (let index = 0; index < args.length; index++) {
    if (['--help', '-h'].includes(args[index])) return { help: true };
    if (args[index] === '--structural-only') { options.structuralOnly = true; continue; }
    const name = names[args[index]];
    if (!name || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option: ${args[index]}`);
    options[name] = name === 'timeoutMs' ? Number(args[++index]) : args[++index];
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) throw new Error('Timeout must be positive.');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: node benchmarks/v2/verify-results.mjs [--report PATH] [--output PATH] [--structural-only] [--lake PATH] [--timeout-ms N]\nMissing/incomplete reports always fail. By default, every SOLVED proof is independently compiled.\n');
    else { const result = await verifyResults(options); if (result.status === 'REJECTED') process.exitCode = 1; }
  } catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; }
}
