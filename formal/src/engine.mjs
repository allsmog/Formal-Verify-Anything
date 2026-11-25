import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Budget, canonicalDigest } from './support.mjs';
import { compileLean, observationFor, assessFinal, FINAL_VALIDATION_POLICY } from './compiler.mjs';
import { validateProblem, validateTactic, sourcePrefix, renderStandalone, validateStandalone, GuardError } from './guard.mjs';
import { deterministicProposer } from './proposers.mjs';

export const ENGINE_VERSION = 'fva-search-v2';
export const DEFAULT_BUDGET = Object.freeze({
  maxCompilerCalls: 64, maxSteps: 64, maxProposalRounds: 3, maxDepth: 8, callTimeoutMs: 30000,
  theoremTimeoutMs: 300000, heartbeats: 200000, maxModelTokens: 0,
});

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const indent = (s, amount = 2) => s.split('\n').map(x => ' '.repeat(amount) + x).join('\n');
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const validTokenCount = value => Number.isSafeInteger(value) && value >= 0;
const failureCode = (error, fallback) => typeof error?.code === 'string' && /^[a-z][a-z0-9_]*$/.test(error.code)
  ? error.code : fallback;

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Preserve explicit provider facts, without arbitrary error properties or the environment. */
function failureDetails(error) {
  const details = { name: error?.name ?? 'Error', message: String(error?.message ?? error) };
  for (const key of ['code', 'retryable', 'status', 'provider', 'usage', 'modelTokens', 'metadata'])
    if (error?.[key] !== undefined) {
      try { details[key] = jsonCopy(error[key]); }
      catch { details[key] = { unavailable: 'not_json_serializable' }; }
    }
  return details;
}

function at(tree, indices) {
  return indices.reduce((node, i) => node.children[i], tree);
}
function replace(tree, indices, node) {
  if (!indices.length) return node;
  const [first, ...rest] = indices;
  const children = [...tree.children];
  children[first] = replace(children[first], rest, node);
  return { ...tree, children };
}
function renderTree(node, ids) {
  if (node.kind === 'hole') { ids?.push(node.id); return `fva_probe "${node.id}"`; }
  if (node.kind === 'trial') {
    ids?.push(node.id);
    return `${node.tactic}\nfva_done "${node.id}"`;
  }
  if (node.kind === 'have')
    return `have ${node.name} : ${node.type} := by\n${indent(renderTree(node.children[0], ids))}\n${renderTree(node.children[1], ids)}`;
  const children = node.children.map(child => `·\n${indent(renderTree(child, ids))}`);
  return [node.tactic, ...children].join('\n');
}
function goalFingerprint(goal) {
  return canonicalDigest({ target: goal.target,
    // Hygienic names contain the attempt's module path. Keep full names in
    // evidence, but exclude that execution metadata from the pruning key.
    hypotheses: goal.hypotheses.map(h => ({ name: h.name.split('._@.')[0], type: h.type, value: h.value })) });
}

/**
 * Compiler-observed DFS with continuations: a local proof is retained only if
 * its remaining siblings and final standalone validation also succeed.
 *
 * Exploration injection (mutually exclusive):
 * - explorationSession: { compile(request), suspend?(), close?() }, caller-owned;
 * - explorationCompiler: async request => compiler result, caller-owned;
 * - explorationSessionFactory: async ({projectRoot,lake,maxOutputBytes}) =>
 *   { compile(request), close() }, engine-owned and closed in finally.
 * Requests contain exact source/sourceFile, kind, nodeId, projectRoot and
 * remaining timeout/output limits. Results have compileLean's result shape.
 * These backends never receive final/recheck requests: those always use two
 * fresh CLI compileLean invocations and the independent kernel audit.
 * An optional suspend() releases cached worker resources before each final
 * candidate; the same session remains reusable if final validation backtracks.
 * A failed engine-owned cleanup leaves a non-enumerable
 * result.retryExplorationCleanup() capability holding that exact owner.
 */
export async function solveTheorem(input, options = {}) {
  const start = performance.now();
  const problem = validateProblem(input);
  const config = { ...DEFAULT_BUDGET, ...options };
  for (const key of Object.keys(DEFAULT_BUDGET)) {
    if (!Number.isSafeInteger(config[key]) || config[key] < (['maxModelTokens', 'maxDepth'].includes(key) ? 0 : 1))
      throw new TypeError(`Invalid budget ${key}`);
  }
  if (config.maxCompilerCalls < 3) throw new TypeError('At least three compiler calls are required');
  if (options.maxOutputBytes !== undefined && (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1))
    throw new TypeError('maxOutputBytes must be a positive safe integer');
  const injected = ['explorationSession', 'explorationCompiler', 'explorationSessionFactory']
    .filter(key => options[key] !== undefined);
  if (injected.length > 1) throw new TypeError('Select only one exploration compiler or session');
  if (options.explorationSession !== undefined && typeof options.explorationSession?.compile !== 'function')
    throw new TypeError('explorationSession.compile must be a function');
  for (const key of ['explorationCompiler', 'explorationSessionFactory'])
    if (options[key] !== undefined && typeof options[key] !== 'function') throw new TypeError(`${key} must be a function`);

  const projectRoot = path.resolve(options.projectRoot ?? defaultRoot);
  const outputDir = path.resolve(options.outputDir ?? path.join(projectRoot, '.fva', 'runs', `${problem.id}-${randomUUID()}`));
  // Record paths inside the project relative to its root, so saved evidence
  // and Lean diagnostics do not depend on where the checkout lives.
  const recordedPath = file => {
    const relative = path.relative(projectRoot, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative.split(path.sep).join('/') : file;
  };
  const attemptDir = path.join(outputDir, 'attempts');
  const proposalDir = path.join(outputDir, 'proposals');
  await mkdir(attemptDir, { recursive: true });
  await mkdir(proposalDir, { recursive: true });
  const compilerBudget = new Budget(config.maxCompilerCalls);
  const stepBudget = new Budget(config.maxSteps);
  const tokenBudget = new Budget(config.maxModelTokens);
  const proposer = options.proposer ?? deterministicProposer;
  const attempts = [], nodes = [], branches = [], proposerCalls = [], finalCandidates = [];
  const policies = new Set();
  let nextNode = 0, maxDepth = 0, steps = 0, modelTokensObserved = 0, modelUsageComplete = true;
  let lastFailure = 'search_exhausted', haltReason = null, firstCandidateSolved = false;
  let status = 'FAILED', proofFile = null, verification = null, lastCompleteSource = null;
  let explorationSession = options.explorationSession ?? (options.explorationCompiler
    ? { compile: options.explorationCompiler } : null);
  let ownsSession = false;
  const cleanup = { ownership: options.explorationSessionFactory ? 'engine' : injected.length ? 'caller' : 'none',
    status: options.explorationSessionFactory ? 'not_created' : injected.length ? 'caller_owned' : 'not_applicable' };
  const hole = depth => ({ id: `n${nextNode++}`, depth, kind: 'hole', children: [] });
  let tree = hole(0);
  const remainingMs = () => Math.max(0, config.theoremTimeoutMs - (performance.now() - start));
  const stop = reason => { lastFailure = reason; return false; };

  async function sessionForExploration() {
    if (!explorationSession && options.explorationSessionFactory) {
      explorationSession = await options.explorationSessionFactory({ projectRoot, lake: config.lake ?? 'lake',
        maxOutputBytes: config.maxOutputBytes ?? 1048576 });
      ownsSession = true;
      cleanup.status = 'open';
      if (!explorationSession || typeof explorationSession.compile !== 'function' || typeof explorationSession.close !== 'function')
        throw new TypeError('An engine-owned exploration session must implement compile and close');
    }
    return explorationSession;
  }

  async function compileSource(source, kind, nodeId, search = true) {
    // Search must leave room for both independent checks. Rejected complete
    // candidates consume the same budget, then search can resume if it fits.
    if (search && compilerBudget.remaining <= 2) { stop('compiler_budget'); return null; }
    if (remainingMs() <= 0) { stop('theorem_timeout'); return null; }
    if (!compilerBudget.tryCharge(1)) { stop('compiler_budget'); return null; }
    const sequence = String(compilerBudget.used).padStart(4, '0');
    const filename = path.join(attemptDir, `${sequence}-${kind}.lean`);
    await writeFile(filename, source, { flag: 'wx' });
    const compileOptions = { lake: config.lake,
      timeoutMs: Math.max(1, Math.min(config.callTimeoutMs, Math.floor(remainingMs()))),
      maxOutputBytes: config.maxOutputBytes ?? 1048576 };
    const compileStart = performance.now();
    let result;
    try {
      const session = search ? await sessionForExploration() : null;
      result = session
        ? await session.compile({ ...compileOptions, projectRoot, sourceFile: recordedPath(filename), source, kind, nodeId })
        : await compileLean(projectRoot, recordedPath(filename), compileOptions);
      if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
          !['diagnostics', 'states', 'closed', 'audits', 'unparsed'].every(key => Array.isArray(result[key])))
        throw Object.assign(new Error('Exploration compiler returned an invalid result'), { code: 'exploration_protocol' });
    } catch (error) {
      const code = failureCode(error, search ? 'exploration_error' : 'compiler_error');
      result = { exitCode: null, signal: null, timedOut: code.includes('timeout'),
        launchError: String(error?.message ?? error), failureCode: code, compilerFailure: failureDetails(error),
        stdout: '', stderr: '', truncated: false, elapsedMs: Math.round(performance.now() - compileStart),
        diagnostics: [], states: [], closed: [], audits: [], unparsed: [] };
    }
    const entry = { ...result, sequence: compilerBudget.used, kind, nodeId, sourceFile: recordedPath(filename),
      sourceHash: canonicalDigest(source),
      backend: search && injected.length ? (result.backend ?? 'injected-exploration') : 'fresh-lean-cli' };
    entry.evidenceId = `ev_${canonicalDigest({ source, exitCode: result.exitCode,
      stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut })}`;
    attempts.push(entry);
    await writeFile(path.join(attemptDir, `${sequence}-${kind}.json`), JSON.stringify(entry, null, 2) + '\n');
    return entry;
  }

  async function observe(plan, nodeId, kind) {
    const ids = [];
    const source = sourcePrefix(problem, config.heartbeats) + indent(renderTree(plan, ids)) + '\n';
    const compilation = await compileSource(source, kind, nodeId);
    if (!compilation) return null;
    const observation = observationFor(compilation, nodeId, ids);
    if (!observation.valid) stop(compilation.failureCode ?? observation.failure);
    return { ...observation, compilation };
  }

  function recordUsage(call, reported) {
    // Parsing a malformed response can throw after usage was already recorded.
    // Never replace known spend with an unrelated parser error's missing usage.
    if (Object.hasOwn(call, 'usageKnown')) return call.usageKnown && !call.tokenBudgetExceeded;
    call.modelTokens = validTokenCount(reported) ? reported : null;
    call.usageKnown = validTokenCount(reported);
    if (!call.usageKnown) { modelUsageComplete = false; return false; }
    modelTokensObserved += reported;
    call.tokenBudgetExceeded = !tokenBudget.tryCharge(reported);
    return !call.tokenBudgetExceeded;
  }

  async function verifyComplete() {
    const candidate = { id: `c${finalCandidates.length}`, planHash: canonicalDigest(tree),
      status: 'CHECKING', policy: FINAL_VALIDATION_POLICY, evidenceIds: [] };
    finalCandidates.push(candidate);
    if (compilerBudget.remaining < 2) { candidate.status = 'REJECTED'; candidate.reason = 'compiler_budget'; return stop('compiler_budget'); }
    let source, guard;
    try {
      source = renderStandalone(problem, renderTree(tree), config.heartbeats);
      guard = validateStandalone(problem, source, config.heartbeats);
    } catch (error) {
      if (!(error instanceof GuardError)) throw error;
      candidate.status = 'REJECTED'; candidate.reason = 'guard_rejected'; candidate.message = error.message;
      return stop('guard_rejected');
    }
    lastCompleteSource = source;
    candidate.sourceHash = guard.sourceHash;
    if (typeof explorationSession?.suspend === 'function') {
      const suspensionStart = performance.now();
      candidate.explorationSuspension = { status: 'SUSPENDING' };
      try {
        // A retained Mathlib environment competes with fresh CLI imports for
        // memory. Release it before the independent admission checks; the
        // session can restart if those checks require further exploration.
        await explorationSession.suspend();
        candidate.explorationSuspension.status = 'SUSPENDED';
      } catch (error) {
        candidate.explorationSuspension.status = 'FAILED';
        candidate.explorationSuspension.error = failureDetails(error);
        candidate.status = 'REJECTED'; candidate.reason = 'exploration_suspend_failed';
        haltReason = candidate.reason;
        return stop(haltReason);
      } finally {
        candidate.explorationSuspension.elapsedMs = Math.round(performance.now() - suspensionStart);
      }
    }
    const checks = [];
    for (const kind of ['final', 'recheck']) {
      // Deliberately independent of every exploration injection path.
      const compiled = await compileSource(source, kind, tree.id, false);
      if (!compiled) { candidate.status = 'REJECTED'; candidate.reason = lastFailure; return false; }
      candidate.evidenceIds.push(compiled.evidenceId);
      const assessment = assessFinal(compiled, problem.id);
      checks.push({ kind, evidenceId: compiled.evidenceId, ...assessment });
      candidate.checks = checks;
      if (!assessment.accepted) {
        candidate.status = 'REJECTED'; candidate.reason = assessment.reason;
        candidate.rejectedEvidenceId = compiled.evidenceId;
        return stop(`final_${assessment.reason}`);
      }
    }
    proofFile = path.join(outputDir, `${problem.id}.lean`);
    const staging = `${proofFile}.tmp`;
    await writeFile(staging, source, { flag: 'wx' });
    validateStandalone(problem, await readFile(staging, 'utf8'), config.heartbeats);
    await rename(staging, proofFile);
    verification = { ...guard, exitCode: 0, audit: checks[1].audit,
      compileEvidence: candidate.evidenceIds, standaloneRecheck: true,
      policy: FINAL_VALIDATION_POLICY, warnings: checks[1].permittedWarnings };
    candidate.status = 'ACCEPTED';
    candidate.reason = null;
    firstCandidateSolved = steps === 1 && tree.children.length === 0;
    return true;
  }

  async function solveAt(indices, ancestors = [], continueAfter = verifyComplete) {
    if (haltReason) return stop(haltReason);
    if (remainingMs() <= 0) return stop('theorem_timeout');
    const original = tree;
    const node = at(tree, indices);
    maxDepth = Math.max(maxDepth, node.depth);
    const observed = await observe(tree, node.id, 'state');
    if (!observed?.valid || observed.goals.length !== 1) return stop(lastFailure === 'search_exhausted' ? 'invalid_decomposition' : lastFailure);
    const goal = observed.goals[0];
    const stateHash = goalFingerprint(goal);
    const record = { id: node.id, visit: nodes.length, depth: node.depth, stateHash, goal,
      status: 'ELABORATOR_OBSERVED', evidenceId: observed.compilation.evidenceId };
    nodes.push(record);
    if (ancestors.includes(stateHash)) { record.status = 'PRUNED_CYCLE'; return stop('cycle'); }
    const context = freeze({ protocol: 1, goal: jsonCopy(goal), imports: [...problem.imports],
      budget: { compilerCallsRemaining: compilerBudget.remaining - 2, maxDepth: config.maxDepth,
        depth: node.depth, modelTokensRemaining: tokenBudget.remaining, remainingMs: Math.floor(remainingMs()) } });
    // Retain the initial convenient node view; exact requests are always saved
    // separately, including repeated visits with changed dependent context.
    await writeFile(path.join(outputDir, `${node.id}-context.json`), JSON.stringify(context, null, 2) + '\n', { flag: 'wx' })
      .catch(error => { if (error.code !== 'EEXIST') throw error; });

    async function* proposeRounds() {
      for (let round = 0; round < config.maxProposalRounds; round++) {
        if (haltReason || remainingMs() <= 0) { stop(haltReason ?? 'theorem_timeout'); return; }
        if (compilerBudget.remaining <= 2 || !stepBudget.remaining) {
          stop(!stepBudget.remaining ? 'step_budget' : 'compiler_budget'); return;
        }
        // Feedback is scoped to this exact node/state. A final rejection is
        // attached to the candidate branch that caused this continuation.
        const feedback = branches.filter(b => b.parent === node.id && b.stateHash === stateHash && b.status === 'PRUNED').slice(-8).map(b => ({
          proposal: b.proposal, failure: b.failure,
          diagnostics: (attempts.find(a => a.evidenceId === (b.rejectedEvidenceId ?? b.evidenceId))?.diagnostics ?? [])
            .filter(d => ['error', 'warning'].includes(d.severity) && d.category !== 'probe_stop')
            .map(d => ({ ...d, message: d.message.slice(0, 1800) })),
        }));
        const request = freeze({ ...context, feedback: jsonCopy(feedback),
          budget: { ...context.budget, compilerCallsRemaining: compilerBudget.remaining - 2,
            modelTokensRemaining: tokenBudget.remaining, remainingMs: Math.floor(remainingMs()) } });
        const sequence = String(proposerCalls.length + 1).padStart(4, '0');
        const call = { id: `p${proposerCalls.length}`, nodeId: node.id, stateHash, round,
          requestDigest: canonicalDigest(request), contextFile: recordedPath(path.join(proposalDir, `${sequence}-context.json`)) };
        proposerCalls.push(call);
        await writeFile(path.resolve(projectRoot, call.contextFile), JSON.stringify(request, null, 2) + '\n');
        const callStart = performance.now();
        let response;
        try {
          response = await proposer(request);
          const withinBudget = recordUsage(call, response?.modelTokens);
          for (const key of ['policy', 'provider', 'usage', 'metadata'])
            if (response?.[key] !== undefined) call[key] = jsonCopy(response[key]);
          if (typeof call.policy === 'string') policies.add(call.policy);
          if (!response || !Array.isArray(response.proposals) || !call.usageKnown) {
            call.status = 'INVALID'; call.failure = 'invalid_proposer_output';
            haltReason = call.usageKnown ? null : 'model_usage_unknown';
            stop(haltReason ?? call.failure); return;
          }
          call.proposals = jsonCopy(response.proposals);
          if (!withinBudget) {
            call.status = 'REJECTED'; call.failure = 'model_token_budget'; haltReason = call.failure;
            stop(call.failure); return;
          }
          call.status = 'RETURNED';
        } catch (error) {
          call.status = 'FAILED'; call.error = failureDetails(error);
          call.failure = failureCode(error, 'proposer_error');
          for (const key of ['provider', 'usage', 'metadata'])
            if (call.error[key] !== undefined) call[key] = call.error[key];
          recordUsage(call, error?.modelTokens);
          record.proposerError = call.error;
          if (error?.retryable === false || !call.usageKnown || call.tokenBudgetExceeded)
            haltReason = call.tokenBudgetExceeded ? 'model_token_budget' : call.failure;
          stop(call.failure); return;
        } finally {
          call.elapsedMs = Math.round(performance.now() - callStart);
          call.evidenceId = `ev_${canonicalDigest(call)}`;
          await writeFile(path.join(proposalDir, `${sequence}-result.json`), JSON.stringify(call, null, 2) + '\n');
        }
        yield* call.proposals.slice(0, stepBudget.remaining);
        if (proposer === deterministicProposer || !call.proposals.length) return;
      }
    }

    const seen = new Set();
    for await (const proposal of proposeRounds()) {
      if (haltReason) return stop(haltReason);
      if (compilerBudget.remaining <= 2 || remainingMs() <= 0) return stop(remainingMs() <= 0 ? 'theorem_timeout' : 'compiler_budget');
      const proposalKey = JSON.stringify(proposal);
      if (seen.has(proposalKey)) continue;
      seen.add(proposalKey);
      if (!stepBudget.tryCharge(1)) return stop('step_budget');
      steps++;
      const beforeHash = canonicalDigest(original);
      const branch = { parent: node.id, visit: record.visit, stateHash, proposal, beforeHash, status: 'TRYING', children: [] };
      branches.push(branch);
      const candidateCount = finalCandidates.length;
      try {
        if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal))
          throw new GuardError('Proposal must be an object');
        if (proposal.kind === 'have') {
          if (typeof proposal.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_']*$/.test(proposal.name) ||
              goal.hypotheses.some(h => h.name === proposal.name))
            throw new GuardError('Sublemma name must be fresh and simple');
          validateTactic(proposal.name);
          validateTactic(proposal.type);
          if (node.depth >= config.maxDepth) { branch.failure = 'depth_limit'; stop('depth_limit'); continue; }
          const children = [hole(node.depth + 1), hole(node.depth + 1)];
          tree = replace(original, indices, { ...node, kind: 'have', name: proposal.name, type: proposal.type, children });
          branch.children = children.map(x => x.id);
          if (await solveAt([...indices, 0], [...ancestors, stateHash],
            () => solveAt([...indices, 1], [...ancestors, stateHash], continueAfter))) {
            branch.status = 'RETAINED'; record.status = 'VERIFIED_IN_FINAL_PROOF'; return true;
          }
        } else {
          if (proposal.kind !== undefined && proposal.kind !== 'tactic') throw new GuardError('Unknown proposal kind');
          validateTactic(proposal.tactic);
          const trial = replace(original, indices, { ...node, kind: 'trial', tactic: proposal.tactic });
          const result = await observe(trial, node.id, 'candidate');
          branch.evidenceId = result?.compilation.evidenceId;
          if (!result?.valid) { branch.failure = lastFailure; continue; }
          if (result.goals.length === 0) {
            tree = replace(original, indices, { ...node, kind: 'tactic', tactic: proposal.tactic, children: [] });
            record.status = 'CLOSED_LOCAL';
            if (await continueAfter()) {
              branch.status = 'RETAINED'; record.status = 'VERIFIED_IN_FINAL_PROOF'; return true;
            }
            continue;
          }
          if (node.depth >= config.maxDepth) { branch.failure = 'depth_limit'; stop('depth_limit'); continue; }
          if (result.goals.length === 1 && goalFingerprint(result.goals[0]) === stateHash) {
            branch.failure = 'no_progress'; stop('no_progress'); continue;
          }
          const children = result.goals.map(() => hole(node.depth + 1));
          tree = replace(original, indices, { ...node, kind: 'tactic', tactic: proposal.tactic, children });
          branch.children = children.map(x => x.id);
          const solveChildren = async i => i === children.length ? continueAfter()
            : solveAt([...indices, i], [...ancestors, stateHash], () => solveChildren(i + 1));
          if (await solveChildren(0)) {
            branch.status = 'RETAINED'; record.status = 'VERIFIED_IN_FINAL_PROOF'; return true;
          }
        }
      } catch (error) {
        if (!(error instanceof GuardError)) throw error;
        branch.failure = 'guard_rejected'; branch.message = error.message; stop('guard_rejected');
      } finally {
        if (branch.status !== 'RETAINED') {
          tree = original;
          branch.status = 'PRUNED';
          branch.failure ??= lastFailure;
          if (finalCandidates.length > candidateCount) {
            const rejected = finalCandidates.slice(candidateCount).filter(c => c.status === 'REJECTED');
            branch.rejectedCandidates = rejected.map(c => c.id);
            branch.rejectedEvidenceId = rejected.at(-1)?.rejectedEvidenceId;
          }
          branch.restoredHash = canonicalDigest(tree);
          if (branch.restoredHash !== beforeHash) throw new Error('Parent proof restoration invariant failed');
        }
      }
    }
    if (!stepBudget.remaining) stop('step_budget');
    record.status = 'EXHAUSTED';
    tree = original;
    return false;
  }

  try {
    if (await solveAt([])) status = 'SOLVED';
  } finally {
    if (ownsSession && explorationSession && typeof explorationSession.close === 'function') {
      try { await explorationSession.close(); cleanup.status = 'closed'; }
      catch (error) { cleanup.status = 'failed'; cleanup.error = failureDetails(error); }
    } else if (ownsSession) {
      cleanup.status = 'failed';
      cleanup.error = { code: 'invalid_exploration_session', message: 'Created session has no cleanup method' };
    }
  }
  if (status !== 'SOLVED') {
    const failureSource = lastCompleteSource ?? sourcePrefix(problem, config.heartbeats) + indent(renderTree(tree)) + '\n';
    await writeFile(path.join(outputDir, `${problem.id}.failed.lean`), failureSource);
    await rm(path.join(outputDir, `${problem.id}.lean.tmp`), { force: true });
  }
  const result = { id: problem.id, tier: problem.tier, status, proofFile: proofFile && recordedPath(proofFile),
    engineVersion: ENGINE_VERSION, validationPolicy: FINAL_VALIDATION_POLICY,
    statementHash: problem.statementHash, provenance: problem.provenance ?? null,
    metrics: { compilerCalls: compilerBudget.used, steps, maxDepth,
      elapsedMs: Math.round(performance.now() - start), firstCandidateSolved: status === 'SOLVED' && firstCandidateSolved,
      modelTokens: modelUsageComplete ? modelTokensObserved : null, modelTokensKnown: modelTokensObserved, modelUsageComplete,
      proposerCalls: proposerCalls.length, finalCandidates: finalCandidates.length },
    budget: Object.fromEntries(Object.keys(DEFAULT_BUDGET).map(k => [k, config[k]])),
    policy: policies.size === 1 ? [...policies][0] : policies.size > 1 ? 'mixed-proposers'
      : typeof proposer.policy === 'string' ? proposer.policy : 'custom-proposer',
    failure: status === 'SOLVED' ? null : lastFailure,
    exploration: { backend: attempts.find(a => !['final', 'recheck'].includes(a.kind))?.backend ?? null, cleanup },
    verification, tree: { finalPlan: tree, nodes, branches }, finalCandidates, proposerCalls, attempts,
  };
  if (cleanup.status === 'failed' && ownsSession && typeof explorationSession?.close === 'function') {
    const owner = explorationSession;
    Object.defineProperty(result, 'retryExplorationCleanup', {
      enumerable: false,
      value: async () => {
        if (cleanup.status === 'closed') return cleanup;
        try { await owner.close(); cleanup.status = 'closed'; delete cleanup.error; }
        catch (error) { cleanup.status = 'failed'; cleanup.error = failureDetails(error); }
        await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
        return cleanup;
      },
    });
  }
  await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
