#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED_BUDGET = Object.freeze({
  maxCompilerCalls: 64,
  maxSteps: 64,
  maxProposalRounds: 3,
  maxDepth: 8,
  callTimeoutMs: 30_000,
  theoremTimeoutMs: 300_000,
  heartbeats: 200_000,
  maxModelTokens: 0,
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function loadProblems(projectRoot = PROJECT_ROOT) {
  const problems = [];
  const datasets = [];
  for (const filename of ['tier1.json', 'minif2f.json']) {
    const bytes = await readFile(path.join(projectRoot, 'benchmarks', filename));
    const dataset = JSON.parse(bytes);
    datasets.push({
      file: `benchmarks/${filename}`,
      sha256: sha256(bytes),
      selectionRule: dataset.selectionRule,
      importPolicy: dataset.importPolicy ?? null,
      sourceRepository: dataset.sourceRepository ?? null,
      sourceCommit: dataset.sourceCommit ?? null,
    });
    for (const problem of dataset.problems) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(problem.id)) {
        throw new Error(`Invalid problem ID: ${problem.id}`);
      }
      if (sha256(problem.statement) !== problem.provenance.statementSha256) {
        throw new Error(`Statement integrity check failed: ${problem.id}`);
      }
      if (problems.some((entry) => entry.id === problem.id)) {
        throw new Error(`Duplicate problem ID: ${problem.id}`);
      }
      problems.push(problem);
    }
  }
  if (problems.filter((problem) => problem.tier === 1).length !== 5 ||
      problems.filter((problem) => problem.tier === 2).length !== 12) {
    throw new Error('Canonical suite must contain exactly five Tier 1 and twelve Tier 2 problems.');
  }
  return { problems, datasets };
}

function textCell(value) {
  return String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function measured(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'unknown';
}

function rate(solved, total) {
  return total ? `${solved}/${total} (${(100 * solved / total).toFixed(1)}%)` : '0/0 (not applicable)';
}

function finalFailure(result) {
  if (result.status === 'SOLVED') return null;
  if (typeof result.failure === 'string') return result.failure;
  return result.failure?.category ?? result.failure?.code ?? result.failure?.kind ?? result.status;
}

function relativeLink(reportDir, projectRoot, filename) {
  if (!filename) return null;
  const absolute = path.isAbsolute(filename) ? filename : path.resolve(projectRoot, filename);
  return path.relative(reportDir, absolute).split(path.sep).map(encodeURIComponent).join('/');
}

function metricSummary(results) {
  const solved = results.filter((result) => result.status === 'SOLVED');
  const solvedCalls = solved.map((result) => result.metrics.compilerCalls);
  const allCalls = results.map((result) => result.metrics.compilerCalls);
  const depths = results.map((result) => result.metrics.maxDepth).filter(Number.isFinite);
  return {
    count: results.length,
    solved: solved.length,
    meanCallsSolved: solvedCalls.length && solvedCalls.every(Number.isFinite)
      ? solvedCalls.reduce((sum, value) => sum + value, 0) / solvedCalls.length : null,
    totalCalls: allCalls.every(Number.isFinite) ? allCalls.reduce((sum, value) => sum + value, 0) : null,
    maxDepth: depths.length ? Math.max(...depths) : null,
  };
}

export function renderReport(evaluation, reportDir, projectRoot = PROJECT_ROOT) {
  const results = evaluation.results;
  const lines = [
    '# Formal Verify Anything: benchmark results',
    '',
    `Run: \`${evaluation.runId}\`  `,
    `Started: ${evaluation.startedAt}; finished: ${evaluation.finishedAt}.  `,
    `Scope: **${evaluation.canonical ? 'canonical complete 17-problem suite' : 'diagnostic subset; not the canonical benchmark'}**.`,
    '',
    '## Evaluation protocol',
    '',
    'One deterministic, bounded search invocation is made per theorem. **pass@1 means success of that single complete search invocation**, including its internal candidate attempts, recursive subgoals, and backtracking. It does not mean that the first tactic worked. There is no model sampling in this baseline and the model-token budget is zero.',
    '',
    'The original theorem declaration text and its SHA-256 are preserved. The execution environment uses fixed, declaration-required Mathlib modules plus the same generic tactic imports. Unused broad namespace openings are omitted; original imports and openings are recorded in each problem’s provenance. Full Mathlib import timed out before search during environment preflight; the diagnostic run remains under benchmarks/runs/. This is an import-restricted benchmark configuration, not the upstream blanket-import environment.',
    '',
    'A theorem counts as SOLVED only when the engine accepts its standalone proof file after Lean compilation with exit code 0, unchanged theorem-statement validation, prohibited-token checks, and kernel dependency checks. Every selected theorem remains in the denominator, including timeouts, budget exhaustion, and harness errors. The report also checks that a reported solved artifact exists, has the locked statement hash, and contains no prohibited proof tokens.',
    '',
    '| Budget | Value |',
    '| --- | ---: |',
    ...Object.entries(evaluation.budget).map(([key, value]) => `| ${textCell(key)} | ${textCell(value)} |`),
    '',
    `Lean toolchain: \`${textCell(evaluation.environment.leanToolchain)}\`.`,
    `Source commit at run start: \`${textCell(evaluation.environment.gitCommit)}\`; working tree dirty: \`${textCell(evaluation.environment.gitDirty)}\`.`,
    `Node: \`${textCell(evaluation.environment.node)}\`; platform: \`${textCell(evaluation.environment.platform)}\`.`,
    '',
    '## Results',
    '',
    '| Suite | Solved / attempted (pass@1) | Mean compiler calls per solved theorem | Compiler calls, all attempts | Maximum recursion depth |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const [label, subset] of [
    ['Tier 1: foundational', results.filter((result) => result.tier === 1)],
    ['Tier 2: miniF2F Test algebra subset', results.filter((result) => result.tier === 2)],
    ['All selected problems', results],
  ]) {
    const summary = metricSummary(subset);
    lines.push(`| ${label} | ${rate(summary.solved, summary.count)} | ${measured(summary.meanCallsSolved, 2)} | ${measured(summary.totalCalls)} | ${measured(summary.maxDepth)} |`);
  }
  const firstCandidateSuccesses = results.filter((result) => result.metrics.firstCandidateSolved === true).length;
  const firstCandidateMeasured = results.filter((result) => typeof result.metrics.firstCandidateSolved === 'boolean').length;
  const tokens = results.map((result) => result.metrics.modelTokens);
  lines.push('',
    `First-candidate success (separate from pass@1): **${rate(firstCandidateSuccesses, results.length)}**; measured for ${firstCandidateMeasured}/${results.length} problems.`,
    `Total recorded model tokens: **${tokens.every(Number.isFinite) ? tokens.reduce((sum, value) => sum + value, 0) : 'unknown (some runs have no telemetry)'}**.`,
    '',
    '| Theorem | Tier | Status | Compiler calls | Search steps | Depth | Seconds | Termination / proof |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |',
  );
  for (const result of results) {
    const proofLink = relativeLink(reportDir, projectRoot, result.proofFile);
    const artifactLink = relativeLink(reportDir, projectRoot, result.artifactDir);
    const label = artifactLink ? `[${result.id}](${artifactLink}/result.json)` : result.id;
    const detail = result.status === 'SOLVED'
      ? `[compiled .lean proof](${proofLink})`
      : textCell(finalFailure(result));
    const seconds = Number.isFinite(result.metrics.elapsedMs) ? result.metrics.elapsedMs / 1000 : null;
    lines.push(`| ${label} | ${result.tier} | ${textCell(result.status)} | ${measured(result.metrics.compilerCalls)} | ${measured(result.metrics.steps)} | ${measured(result.metrics.maxDepth)} | ${measured(seconds, 2)} | ${detail} |`);
  }
  lines.push('', '## Failure modes', '');
  const counts = new Map();
  for (const result of results) {
    const category = finalFailure(result);
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  if (!counts.size) {
    lines.push('No final theorem failures were observed in this run. Rejected internal branches, if any, remain in each theorem’s attempt log.');
  } else {
    lines.push('| Final termination category | Theorems |', '| --- | ---: |');
    for (const [category, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| ${textCell(category)} | ${count} |`);
    }
  }
  lines.push('',
    'The detailed JSON and each theorem’s `result.json` preserve the proof tree, individual attempts, compiler diagnostics, and final failure details. A search that exhausts its configured resources does not establish that a theorem is false or unprovable.',
    '',
    '## Dataset provenance and limits',
    '',
  );
  for (const dataset of evaluation.datasets) {
    lines.push(`- \`${dataset.file}\`: ${dataset.selectionRule} SHA-256: \`${dataset.sha256}\`.`);
    if (dataset.sourceRepository) lines.push(`  Source: [${dataset.sourceRepository}](${dataset.sourceRepository}/tree/${dataset.sourceCommit}), commit \`${dataset.sourceCommit}\`.`);
  }
  lines.push('',
    'Tier 1 is a constructed sanity suite. Tier 2 preserves the original theorem declarations from the fixed miniF2F revision. Runtime imports include mathlib, but never the miniF2F theorem modules or their proof bodies. Upstream’s unlimited-heartbeat setting is not copied into the run.',
    '',
    'This is a small, deliberately fixed algebra subset. It is not a result on all miniF2F, PutnamBench, or arbitrary software specifications. The experiment measures the implemented deterministic search policy; it does not measure an LLM’s independent theorem-proving ability. Public benchmark contamination in future model-backed experiments would require a separate assessment.',
    '',
    'Compiler calls count the engine’s actual recorded calls, including rejected candidates and final validation as implemented by the engine. Time is end-to-end per-theorem wall time. CPU time, peak process-family memory, and cold-versus-warm cache effects are not measured. Missing telemetry is reported as unknown, not zero.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'node scripts/fetch-minif2f.mjs --check',
    'lake exe cache get',
    'lake build',
    'node benchmarks/run.mjs --tier all',
    '```',
    '',
    'Diagnostic runs such as `node benchmarks/run.mjs --only mathd_algebra_142` write separate reports under `benchmarks/runs/` and cannot overwrite this canonical report. Original benchmark licenses and attribution are in `benchmarks/licenses/` and `benchmarks/README.md`.',
    '',
  );
  return lines.join('\n');
}

function gitValue(projectRoot, args) {
  try { return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

async function validateSolvedArtifact(problem, result, projectRoot) {
  if (result.status !== 'SOLVED') return;
  if (!result.proofFile || result.statementHash !== problem.provenance.statementSha256) {
    throw new Error('SOLVED result lacks its proof path or has a different statement hash.');
  }
  const source = await readFile(path.resolve(projectRoot, result.proofFile), 'utf8');
  if (!source.includes(problem.statement) || /\b(?:sorry|admit|axiom)\b/u.test(source)) {
    throw new Error('SOLVED artifact has a changed theorem declaration or prohibited proof token.');
  }
}

function portablePaths(value, projectRoot) {
  if (typeof value === 'string' && value.startsWith(`${projectRoot}${path.sep}`)) {
    return path.relative(projectRoot, value).split(path.sep).join('/');
  }
  if (Array.isArray(value)) return value.map((entry) => portablePaths(entry, projectRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, portablePaths(entry, projectRoot)]));
  }
  return value;
}

export async function runBenchmarks({ tier = 'all', only = null, canonical = false, projectRoot = PROJECT_ROOT } = {}) {
  const { problems: allProblems, datasets } = await loadProblems(projectRoot);
  const problems = allProblems.filter((problem) =>
    (tier === 'all' || String(problem.tier) === tier) && (!only || problem.id === only));
  if (!problems.length) throw new Error('No problems match the requested tier and ID.');
  // A canonical run covers the whole suite and is written once. Every other
  // run is diagnostic and can never replace the published results.
  if (canonical) {
    if (tier !== 'all' || only || problems.length !== allProblems.length)
      throw new Error('A canonical run must cover the complete suite.');
    const published = await readFile(path.join(projectRoot, 'benchmarks', 'results.json')).then(() => true, () => false);
    if (published) throw new Error('benchmarks/results.json already exists; a canonical run never replaces published results.');
  }
  const { solveTheorem, DEFAULT_BUDGET } = await import('../formal/src/engine.mjs');
  const budget = { ...DEFAULT_BUDGET, ...FIXED_BUDGET };
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replaceAll(':', '-').replaceAll('.', '-')}-${canonical ? 'canonical' : (only ?? `tier-${tier}`)}`;
  const runDir = path.join(projectRoot, 'benchmarks', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const evaluation = {
    schemaVersion: 1, runId, canonical, startedAt, finishedAt: null, budget, datasets,
    selectedIds: problems.map((problem) => problem.id),
    environment: {
      leanToolchain: (await readFile(path.join(projectRoot, 'lean-toolchain'), 'utf8')).trim(),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      gitCommit: gitValue(projectRoot, ['rev-parse', 'HEAD']),
      gitDirty: Boolean(gitValue(projectRoot, ['status', '--porcelain'])),
      sourceHashes: Object.fromEntries(await Promise.all([
        'formal/src/engine.mjs', 'formal/src/compiler.mjs', 'formal/src/guard.mjs',
        'formal/src/proposers.mjs', 'formal/src/support.mjs', 'FormalVerify/Bridge.lean',
        'lean-toolchain', 'lake-manifest.json', 'benchmarks/run.mjs',
      ].map(async file => [file, sha256(await readFile(path.join(projectRoot, file)))]))),
    },
    results: [],
  };
  await writeFile(path.join(runDir, 'progress.json'), `${JSON.stringify(evaluation, null, 2)}\n`);
  for (const [index, problem] of problems.entries()) {
    const outputDir = path.join(runDir, problem.id);
    await mkdir(outputDir, { recursive: true });
    process.stdout.write(`[${index + 1}/${problems.length}] ${problem.id}\n`);
    let result;
    try {
      result = await solveTheorem(problem, { ...budget, projectRoot, outputDir });
      await validateSolvedArtifact(problem, result, projectRoot);
    } catch (error) {
      result = {
        ...(result ?? {}), id: problem.id, status: 'ERROR', proofFile: null,
        statementHash: problem.provenance.statementSha256,
        metrics: result?.metrics ?? { compilerCalls: null, steps: null, maxDepth: null, elapsedMs: null, firstCandidateSolved: null, modelTokens: null },
        failure: { category: 'harness_exception', message: String(error?.message ?? error) },
        tree: result?.tree ?? null, attempts: result?.attempts ?? [],
      };
    }
    result = portablePaths({ ...result, id: problem.id, tier: problem.tier, provenance: problem.provenance, artifactDir: outputDir }, projectRoot);
    // Keep complete traces once, in the per-theorem result and attempt files.
    // The aggregate report links them instead of duplicating every transcript.
    const { tree: proofTree, attempts: compilerAttempts, ...summaryResult } = result;
    evaluation.results.push({ ...summaryResult, detailsFile: `${result.artifactDir}/result.json`,
      attemptCount: compilerAttempts?.length ?? null,
      prunedBranches: proofTree?.branches?.filter(branch => branch.status === 'PRUNED').length ?? null });
    await writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(path.join(runDir, 'progress.json'), `${JSON.stringify(evaluation, null, 2)}\n`);
    process.stdout.write(`  ${result.status}; compiler calls=${result.metrics.compilerCalls ?? 'unknown'}; depth=${result.metrics.maxDepth ?? 'unknown'}\n`);
  }
  evaluation.finishedAt = new Date().toISOString();
  const serialized = `${JSON.stringify(evaluation, null, 2)}\n`;
  await writeFile(path.join(runDir, 'results.json'), serialized);
  await writeFile(path.join(runDir, 'results.md'), renderReport(evaluation, runDir, projectRoot));
  if (canonical) {
    const benchmarkDir = path.join(projectRoot, 'benchmarks');
    await writeFile(path.join(benchmarkDir, 'results.json'), serialized);
    await writeFile(path.join(benchmarkDir, 'results.md'), renderReport(evaluation, benchmarkDir, projectRoot));
  }
  const summary = metricSummary(evaluation.results);
  process.stdout.write(`pass@1 ${rate(summary.solved, summary.count)}\nReport: ${path.join(runDir, 'results.md')}\n`);
  return evaluation;
}

function parseArgs(args) {
  const options = { tier: 'all', only: null, canonical: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--tier') options.tier = args[++index];
    else if (argument === '--only') options.only = args[++index];
    else if (argument === '--canonical') options.canonical = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!['all', '1', '2'].includes(options.tier)) throw new Error('--tier must be all, 1, or 2.');
  if (args.includes('--only') && !options.only) throw new Error('--only requires a problem ID.');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: node benchmarks/run.mjs [--tier all|1|2] [--only ID] [--canonical]\nRuns are diagnostic by default. --canonical runs the complete suite and writes\nbenchmarks/results.{json,md}; it refuses to replace existing published results.\n');
    else await runBenchmarks(options);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
