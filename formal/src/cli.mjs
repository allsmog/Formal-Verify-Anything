#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, readdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProblem, validateStandalone } from './guard.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPECTED_TOOLCHAIN = 'leanprover/lean4:v4.24.0';
const EXPECTED_MATHLIB = 'f897ebcf72cd16f89ab4577d0c826cd14afaafc7';
const MATHLIB_URL = 'https://github.com/leanprover-community/mathlib4.git';

const HELP = `Formal Verify Anything

Usage:
  node formal/src/cli.mjs doctor [--proposer codex]
  node formal/src/cli.mjs solve <problem-or-dataset.json> [--id ID] [--out DIRECTORY]
      [--proposer deterministic|codex|command] [--compiler process|worker]
      [--model ID] [--proposer-command JSON_ARGV] [--model-token-budget N]
      [--max-compiler-calls N] [--max-steps N] [--max-depth N]
      [--timeout-ms N] [--call-timeout-ms N] [--proposer-timeout-ms N]
      [--max-proposal-rounds N] [--heartbeats N]
  node formal/src/cli.mjs verify <problem-or-dataset.json> <proof.lean> [--id ID]

solve defaults to deterministic-v2 and fresh Lean processes. Codex is explicit
and uses existing CLI authentication; it never silently falls back to another policy.
The worker caches imports for exploration; both final checks remain fresh processes.
A dataset without --id runs all its entries sequentially with a fresh budget each.
--out names a new or empty output directory; complete evidence is retained there.
verify matches the original manifest, validates the exact scaffold, and compiles
an immutable snapshot with the mandatory kernel-dependency audit.
doctor checks command versions and pinned local configuration; it installs nothing.
With --proposer codex it also checks CLI authentication and runtime writability,
without making a model request. Actual token usage is recorded when supplied by
Codex; the token allowance is an admission threshold, not a provider billing cap.

Exit codes: 0 = all solved/verified or doctor checks pass; 1 = unsolved/rejected or
failed environment check; 2 = malformed input, configuration, or invocation error.
`;

class CliError extends Error {
  constructor(message) { super(message); this.name = 'CliError'; }
}

function parseArguments(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help')
    return { command: 'help', positional: [] };
  const [command, ...rest] = argv;
  if (!['doctor', 'solve', 'verify'].includes(command)) throw new CliError(`Unknown command: ${command}`);
  const permitted = command === 'solve'
    ? new Set(['--id', '--out', '--proposer', '--compiler', '--model', '--proposer-command', '--model-token-budget',
      '--max-compiler-calls', '--max-steps', '--max-depth', '--timeout-ms', '--call-timeout-ms',
      '--proposer-timeout-ms', '--max-proposal-rounds', '--heartbeats'])
    : command === 'verify' ? new Set(['--id']) : new Set(['--proposer']);
  const parsed = { command, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith('--')) { parsed.positional.push(word); continue; }
    if (!permitted.has(word)) throw new CliError(`Unknown ${command} option: ${word}`);
    if (Object.hasOwn(parsed, word)) throw new CliError(`Repeated option: ${word}`);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--') || !value.length)
      throw new CliError(`Missing value for ${word}`);
    parsed[word] = value;
  }
  const count = { doctor: 0, solve: 1, verify: 2 }[command];
  if (parsed.positional.length !== count)
    throw new CliError(`${command} expects ${count} positional argument${count === 1 ? '' : 's'}; use --help`);
  return parsed;
}

async function loadProblems(filename) {
  let document;
  try { document = JSON.parse(await readFile(path.resolve(filename), 'utf8')); }
  catch (error) { throw new CliError(`Cannot read problem JSON: ${error.message}`); }
  const records = Array.isArray(document) ? document
    : document && Array.isArray(document.problems) ? document.problems : [document];
  if (!records.length) throw new CliError('The dataset contains no problems');
  const problems = records.map(validateProblem);
  if (new Set(problems.map(problem => problem.id)).size !== problems.length)
    throw new CliError('The dataset contains duplicate theorem identifiers');
  return problems;
}

function selectProblems(problems, id) {
  if (id === undefined) return problems;
  const selected = problems.filter(problem => problem.id === id);
  if (selected.length !== 1) throw new CliError(`The original manifest has no unique theorem named ${id}`);
  return selected;
}

async function runtimeModule(name) {
  return import(`./${name}.mjs`);
}

async function doctor(args) {
  if (args['--proposer'] !== undefined && args['--proposer'] !== 'codex')
    throw new CliError('doctor supports only the optional --proposer codex check');
  const { runProcess } = await runtimeModule('compiler');
  const checks = [];
  for (const command of ['lean', 'lake']) {
    const result = await runProcess(command, ['--version'], { cwd: PROJECT_ROOT, timeoutMs: 10000 });
    const text = (result.stdout + result.stderr).trim();
    const matches = command === 'lean' ? /Lean \(version 4\.24\.0(?:,|\))/.test(text)
      : /Lean version 4\.24\.0(?:\)|\s|$)/.test(text);
    checks.push({ name: `${command} --version`, ok: result.exitCode === 0 && !result.timedOut &&
      !result.launchError && !result.truncated && matches, observed: text || result.launchError || null });
  }
  try {
    const value = (await readFile(path.join(PROJECT_ROOT, 'lean-toolchain'), 'utf8')).trim();
    checks.push({ name: 'lean-toolchain pin', ok: value === EXPECTED_TOOLCHAIN, expected: EXPECTED_TOOLCHAIN, observed: value });
  } catch (error) { checks.push({ name: 'lean-toolchain pin', ok: false, error: error.message }); }
  try {
    const manifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'lake-manifest.json'), 'utf8'));
    const entries = manifest.packages?.filter(item => item.name === 'mathlib') ?? [];
    const value = entries[0];
    checks.push({ name: 'mathlib manifest pin', ok: entries.length === 1 && value.rev === EXPECTED_MATHLIB &&
      value.url === MATHLIB_URL, expected: EXPECTED_MATHLIB, observed: value?.rev ?? null, repository: value?.url ?? null });
  } catch (error) { checks.push({ name: 'mathlib manifest pin', ok: false, error: error.message }); }
  if (args['--proposer'] === 'codex') {
    const version = await runProcess('codex', ['--version'], { cwd: PROJECT_ROOT, timeoutMs: 10000, maxOutputBytes: 4096 });
    checks.push({ name: 'Codex CLI', ok: version.exitCode === 0 && !version.timedOut && !version.truncated,
      observed: version.stdout.trim() || version.launchError });
    const auth = await runProcess('codex', ['login', 'status'], { cwd: PROJECT_ROOT, timeoutMs: 10000, maxOutputBytes: 4096 });
    checks.push({ name: 'Codex authentication', ok: auth.exitCode === 0 && !auth.timedOut && !auth.truncated,
      observed: (auth.stdout + auth.stderr).trim() || auth.launchError });
    const runtimeHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const writable = await access(runtimeHome, constants.W_OK).then(() => true, () => false);
    checks.push({ name: 'Codex runtime directory writable', ok: writable,
      observed: runtimeHome, remedy: writable ? null : 'Run Codex from an environment with a writable authenticated runtime directory; a writable project alone is insufficient.' });
  }
  const ok = checks.every(check => check.ok);
  console.log(JSON.stringify({ status: ok ? 'OK' : 'NOT_READY', projectRoot: PROJECT_ROOT,
    scope: 'Installed command versions and local lockfile pins; proof compilation and cache completeness are not checked.',
    checks }, null, 2));
  return ok ? 0 : 1;
}

async function ensureEmpty(directory) {
  try {
    if ((await readdir(directory)).length) throw new CliError(`Output directory is not empty: ${directory}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function solve(args) {
  const { solveTheorem, DEFAULT_BUDGET } = await runtimeModule('engine');
  const problems = selectProblems(await loadProblems(args.positional[0]), args['--id']);
  const root = path.resolve(args['--out'] ?? path.join(PROJECT_ROOT, '.fva', 'runs',
    `${problems.length === 1 ? problems[0].id : 'batch'}-${randomUUID()}`));
  await ensureEmpty(root);
  const options = { projectRoot: PROJECT_ROOT };
  const numeric = {
    '--max-compiler-calls': ['maxCompilerCalls', 3], '--max-steps': ['maxSteps', 1], '--max-depth': ['maxDepth', 0],
    '--timeout-ms': ['theoremTimeoutMs', 1], '--call-timeout-ms': ['callTimeoutMs', 1],
    '--max-proposal-rounds': ['maxProposalRounds', 1], '--heartbeats': ['heartbeats', 1],
  };
  const numberOption = (flag, minimum = 0) => {
    const value = args[flag];
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
      throw new CliError(`${flag} must be a safe integer at least ${minimum}`);
    return Number(value);
  };
  for (const [flag, [key, minimum]] of Object.entries(numeric))
    if (args[flag] !== undefined) options[key] = numberOption(flag, minimum);
  const provider = args['--proposer'] ?? (args['--proposer-command'] ? 'command' : 'deterministic');
  if (!['deterministic', 'codex', 'command'].includes(provider)) throw new CliError('Unknown proposer; choose deterministic, codex, or command');
  if (args['--model'] !== undefined && provider !== 'codex') throw new CliError('--model requires --proposer codex');
  if (args['--proposer-command'] !== undefined && provider !== 'command') throw new CliError('--proposer-command requires the command proposer');
  if (provider === 'command' && args['--proposer-command'] === undefined) throw new CliError('The command proposer requires --proposer-command JSON_ARGV');
  const compiler = args['--compiler'] ?? 'process';
  if (!['process', 'worker'].includes(compiler)) throw new CliError('Unknown compiler; choose process or worker');
  if (compiler === 'worker') options.explorationSessionFactory = (await runtimeModule('lean-session')).createLeanSession;
  const proposerTimeoutMs = args['--proposer-timeout-ms'] === undefined ? 60000 : numberOption('--proposer-timeout-ms', 1);
  if (args['--model-token-budget'] !== undefined) {
    options.maxModelTokens = numberOption('--model-token-budget');
  }
  if (provider === 'codex') {
    options.maxModelTokens ??= 50000;
    if (!options.maxModelTokens) throw new CliError('Codex requires a positive --model-token-budget');
    options.proposer = (await runtimeModule('codex-proposer')).makeCodexProposer({ model: args['--model'], timeoutMs: proposerTimeoutMs });
  }
  if (args['--proposer-command'] !== undefined) {
    let argv;
    try { argv = JSON.parse(args['--proposer-command']); }
    catch { throw new CliError('--proposer-command must be a JSON argv array, such as ["node","/absolute/proposer.mjs"]'); }
    const { commandProposer } = await runtimeModule('proposers');
    options.proposer = commandProposer(argv, { timeoutMs: proposerTimeoutMs });
  }
  const results = [];
  const providerCleanup = [];
  let explorationCleanupBlocked = false;
  for (const [index, problem] of problems.entries()) {
    const outputDir = problems.length === 1 ? root : path.join(root, problem.id);
    process.stderr.write(`[${index + 1}/${problems.length}] Proving ${problem.id}\n`);
    const result = await solveTheorem(problem, { ...options, outputDir });
    if (typeof result.retryExplorationCleanup === 'function') {
      try { await result.retryExplorationCleanup(); }
      catch (error) {
        result.exploration.cleanup.status = 'failed';
        result.exploration.cleanup.retryError = { message: error.message };
      }
    }
    explorationCleanupBlocked = result.exploration.cleanup.status === 'failed';
    const summary = { id: result.id, status: result.status, failure: result.failure,
      policy: result.policy, metrics: result.metrics, budget: result.budget,
      proofFile: result.proofFile && path.resolve(PROJECT_ROOT, result.proofFile), resultFile: path.join(outputDir, 'result.json'),
      verification: result.verification, exploration: result.exploration };
    results.push(summary);
    process.stderr.write(`${result.id}: ${result.status}${result.failure ? ` (${result.failure})` : ''}\n`);
    if (options.proposer?.retryCleanup) {
      const retried = await options.proposer.retryCleanup();
      providerCleanup.push(...retried);
      if (retried.some(item => item.status === 'failed')) break;
    }
    if (explorationCleanupBlocked) break;
  }
  const solved = results.filter(result => result.status === 'SOLVED').length;
  const complete = solved === problems.length && !explorationCleanupBlocked && !providerCleanup.some(item => item.status === 'failed');
  const summary = { status: complete ? 'SOLVED' : 'INCOMPLETE', solved,
    total: problems.length, attempted: results.length, outputDir: root, provider, compiler, providerCleanup,
    explorationCleanupBlocked, defaultBudget: DEFAULT_BUDGET, results };
  await writeFile(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  return complete ? 0 : 1;
}

async function verify(args) {
  const { compileLean, assessFinal } = await runtimeModule('compiler');
  const { DEFAULT_BUDGET } = await runtimeModule('engine');
  const proofFile = path.resolve(args.positional[1]);
  const source = await readFile(proofFile, 'utf8');
  const suffix = source.match(/\n\n#fva_audit ([A-Za-z_][A-Za-z0-9_']*)\n$/);
  const selected = selectProblems(await loadProblems(args.positional[0]), args['--id'] ?? suffix?.[1]);
  if (selected.length !== 1) throw new CliError('Use --id to select the original theorem for verification');
  const problem = selected[0];
  const budgetLines = [...source.matchAll(/^set_option maxHeartbeats ([1-9]\d*)$/gm)];
  let heartbeats, guard;
  try {
    if (budgetLines.length !== 1 || !Number.isSafeInteger(Number(budgetLines[0][1])))
      throw new CliError('The proof must contain one positive, safe heartbeat budget in its fixed scaffold');
    heartbeats = Number(budgetLines[0][1]);
    guard = validateStandalone(problem, source, heartbeats);
  } catch (error) {
    if (error.code !== 'guard_rejected' && !(error instanceof CliError)) throw error;
    console.log(JSON.stringify({ status: 'REJECTED', id: problem.id, proofFile,
      reason: error.message, compilerCalled: false }, null, 2));
    return 1;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-verify-'));
  let result;
  try {
    const snapshot = path.join(directory, `${problem.id}.lean`);
    await writeFile(snapshot, source, { flag: 'wx', mode: 0o444 });
    result = await compileLean(PROJECT_ROOT, snapshot, { timeoutMs: DEFAULT_BUDGET.callTimeoutMs });
  } finally { await rm(directory, { recursive: true, force: true }); }
  const unchanged = await readFile(proofFile, 'utf8').then(text => text === source, () => false);
  const assessment = assessFinal(result, problem.id);
  const verified = unchanged && assessment.accepted;
  console.log(JSON.stringify({ status: verified ? 'VERIFIED' : 'REJECTED', id: problem.id,
    proofFile, ...guard, heartbeats, fileUnchanged: unchanged, exitCode: result.exitCode,
    timedOut: result.timedOut, launchError: result.launchError, truncated: result.truncated,
    assessment,
    diagnostics: result.diagnostics, unparsed: result.unparsed, stderr: result.stderr }, null, 2));
  return verified ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.command === 'help') { process.stdout.write(HELP); return 0; }
  if (args.command === 'doctor') return doctor(args);
  if (args.command === 'solve') return solve(args);
  return verify(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ status: 'ERROR', code: error.code ?? 'invalid_invocation', message: error.message }) + '\n');
    process.exitCode = 2;
  });
}
