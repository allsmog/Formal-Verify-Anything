import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertReportStructure, verifyResults } from './verify-results.mjs';
import { probeCodex, SHARED_BUDGET } from './run.mjs';
import { retainCleanupOwners, settleInvocationCleanup } from './lifecycle.mjs';
import { loadHoldout, sha256 } from './suite.mjs';
import { renderComparison, summarize } from './report.mjs';

const frozen = await loadHoldout();
// Synthetic accounting fixtures exist only in test memory. They are never
// written as benchmark results and do not represent provider/Lean execution.
function fixture({ blocked = true } = {}) {
  const plannedSchedule = frozen.problems.flatMap((problem, index) => (index % 2 === 0
    ? ['deterministic-v2', 'codex'] : ['codex', 'deterministic-v2']).map((method) => ({ id: problem.id, method })));
  const schedule = plannedSchedule.filter((entry) => !blocked || entry.method !== 'codex');
  const sourceAndArtifactHashes = Object.fromEntries([
    'formal/src/engine.mjs', 'formal/src/compiler.mjs', 'formal/src/guard.mjs',
    'formal/src/proposers.mjs', 'formal/src/codex-proposer.mjs', 'formal/src/lean-session.mjs',
    'formal/src/support.mjs', 'FormalVerify/Bridge.lean', 'FormalVerify/Worker.lean',
    '.lake/build/lib/lean/FormalVerify/Bridge.olean', 'lean-toolchain', 'lakefile.toml', 'lake-manifest.json',
    'benchmarks/v2/run.mjs', 'benchmarks/v2/suite.mjs', 'benchmarks/v2/lifecycle.mjs',
  ].map((filename) => [filename, sha256(`synthetic test fixture: ${filename}`)]));
  return {
    schemaVersion: 2, runId: 'synthetic-accounting-fixture', canonicalComparisonRequested: true,
    canonicalComparison: !blocked, comparisonStatus: blocked ? 'BLOCKED_PROVIDER' : 'COMPLETE',
    executionComplete: true, startedAt: '2026-11-20T00:00:00.000Z', finishedAt: '2026-11-20T00:01:00.000Z',
    methods: ['deterministic-v2', 'codex'], selectedIds: frozen.problems.map((problem) => problem.id),
    plannedSchedule, schedule, sharedBudget: { ...SHARED_BUDGET }, modelTokenBudget: 50_000, compilerMode: 'worker',
    sourceCommit: frozen.suite.sourceCommit, selectionFrozenAt: frozen.selection.frozenAtUtc,
    inputHashes: { ...frozen.inputHashes },
    environment: { sourceAndArtifactHashes, sourceAndArtifactHashesAfter: { ...sourceAndArtifactHashes }, executionBytesUnchanged: true },
    protocolIntegrity: { valid: true, executionBytesUnchanged: true, inputBytesUnchanged: true,
      cleanupResolved: true, executionComplete: true, inputHashesAfter: { ...frozen.inputHashes } },
    providerAvailability: { 'deterministic-v2': 'AVAILABLE', codex: blocked ? 'BLOCKED' : 'AVAILABLE' },
    blockedProviders: blocked ? ['codex'] : [],
    providerPreflight: { method: 'codex', status: blocked ? 'BLOCKED' : 'AVAILABLE', cleanupAssessment: { status: 'closed' },
      ...(blocked ? { error: { code: 'test_fixture', message: 'Synthetic unavailable provider.' } } : { response: { proposals: [], modelTokens: 0 } }) },
    results: schedule.map(({ id, method }) => {
      const problem = frozen.problems.find((entry) => entry.id === id);
      return { id, method, category: problem.category, status: 'FAILED', failure: 'test_fixture',
        statementHash: problem.provenance.statementSha256, provenance: structuredClone(problem.provenance),
        effectiveImports: [...problem.imports], effectiveOpens: [...problem.opens], cleanupAssessment: { status: 'closed' } };
    }),
  };
}

test('a blocked provider has 24 deterministic attempts and no model score', () => {
  const checked = assertReportStructure(fixture(), frozen);
  assert.deepEqual(checked, { selected: 24, deterministicAttempts: 24, codexAttempts: 0, codexStatus: 'BLOCKED_NO_SCORE', solved: 0 });
});

test('an available provider requires complete paired 24-problem coverage', () => {
  assert.equal(assertReportStructure(fixture({ blocked: false }), frozen).codexAttempts, 24);
  const report = fixture({ blocked: false });
  report.results.splice(report.results.findIndex((entry) => entry.method === 'codex'), 1);
  assert.throws(() => assertReportStructure(report, frozen), /all 24 results/);
});

test('missing and duplicate deterministic rows cannot shrink the denominator', () => {
  const missing = fixture(); missing.results.pop();
  assert.throws(() => assertReportStructure(missing, frozen), /exactly 24 deterministic/);
  const duplicate = fixture(); duplicate.results[23] = structuredClone(duplicate.results[0]);
  assert.throws(() => assertReportStructure(duplicate, frozen), /Duplicate/);
});

test('a blocked provider cannot be reported as 24 theorem failures', () => {
  const report = fixture();
  report.results.push(...report.results.map((entry) => ({ ...entry, method: 'codex' })));
  assert.throws(() => assertReportStructure(report, frozen), /zero blocked-provider theorem attempts/);
});

test('selection, import, budget, provenance, and cleanup changes are rejected', () => {
  const mutations = [
    (report) => { report.inputHashes['benchmarks/v2/holdout.json'] = '0'.repeat(64); },
    (report) => { report.results[0].statementHash = '0'.repeat(64); },
    (report) => { report.results[0].effectiveImports = ['Mathlib']; },
    (report) => { report.sharedBudget.maxCompilerCalls = 65; },
    (report) => { report.environment.sourceAndArtifactHashesAfter['formal/src/engine.mjs'] = '0'.repeat(64); },
    (report) => { report.results[0].cleanupAssessment.status = 'failed'; },
    (report) => { report.executionComplete = false; },
  ];
  for (const mutate of mutations) { const report = fixture(); mutate(report); assert.throws(() => assertReportStructure(report, frozen)); }
});

test('missing report never silently skips rechecking', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-v2-missing-'));
  try { await assert.rejects(verifyResults({ projectRoot: directory, structuralOnly: true }), { code: 'ENOENT' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('unknown model usage remains unknown rather than becoming zero', () => {
  const summary = summarize([
    { status: 'FAILED', metrics: { compilerCalls: 2, modelTokens: null, modelTokensKnown: 7, modelUsageComplete: false } },
    { status: 'SOLVED', metrics: { compilerCalls: 4, modelTokens: 3, modelTokensKnown: 3, modelUsageComplete: true } },
  ]);
  assert.equal(summary.modelTokens, null);
  assert.equal(summary.knownModelTokens, 10);
  assert.equal(summary.usageComplete, false);
});

test('the blocked-provider report explicitly omits a model score and describes admission allowance', () => {
  const report = fixture();
  const rendered = renderComparison(report, '/tmp/report', '/tmp');
  assert.match(rendered, /BLOCKED: 0 theorem attempts; no score/);
  assert.match(rendered, /not a provider billing cap/);
  assert.doesNotMatch(rendered, /Paired outcomes:/);
});

test('live worker and provider cleanup capabilities are retried before serialization', async () => {
  let workerRetries = 0, providerRetries = 0;
  const result = { exploration: { cleanup: { ownership: 'engine', status: 'failed' } } };
  Object.defineProperty(result, 'retryExplorationCleanup', { value: async () => {
    workerRetries++; result.exploration.cleanup.status = 'closed'; return result.exploration.cleanup;
  } });
  const proposer = Object.assign(async () => {}, { retryCleanup: async () => { providerRetries++; return []; } });
  const assessment = await settleInvocationCleanup(result, proposer);
  assert.equal(assessment.status, 'closed');
  assert.equal(workerRetries, 1); assert.equal(providerRetries, 1);
  assert.equal(JSON.parse(JSON.stringify(assessment)).exploration.status, 'closed');
});

test('an unresolved cleanup owner is retained for a later retry', async () => {
  let resolved = false;
  const result = { exploration: { cleanup: { ownership: 'engine', status: 'failed' } },
    retryExplorationCleanup: async () => ({ ownership: 'engine', status: resolved ? 'closed' : 'failed' }) };
  const assessment = await settleInvocationCleanup(result, null);
  assert.equal(assessment.status, 'failed');
  const run = {};
  retainCleanupOwners(run, [assessment]);
  assert.equal(typeof run.retryCleanup, 'function');
  assert.equal(JSON.stringify(run), '{}');
  resolved = true;
  assert.equal((await run.retryCleanup())[0].status, 'closed');
});

test('preflight preserves the real error shape and retries provider cleanup once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-v2-preflight-fixture-'));
  let retries = 0;
  const proposer = Object.assign(async () => {
    throw Object.assign(new Error('Synthetic startup failure.'), { code: 'provider_startup', modelTokens: 0,
      metadata: { fixture: true, stderrDiagnostic: 'Synthetic read-only runtime.' } });
  }, { retryCleanup: async () => { retries++; return []; } });
  try {
    const evidence = await probeCodex(() => proposer, { command: 'synthetic-fixture-only' }, 50_000, directory);
    assert.equal(evidence.status, 'BLOCKED'); assert.equal(evidence.error.modelTokens, 0); assert.equal(retries, 1);
    const saved = JSON.parse(await readFile(path.join(directory, 'provider-preflight.json'), 'utf8'));
    assert.equal(saved.error.metadata.fixture, true); assert.equal(saved.cleanupAssessment.status, 'closed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
