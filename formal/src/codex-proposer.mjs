import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './compiler.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const diagnosticExcerpt = value => String(value ?? '').replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]').slice(0, 4096);

export class ProposerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProposerError';
    Object.assign(this, { code, provider: 'codex-cli', retryable: false, modelTokens: null }, details);
  }
}

export function proposalSchema(maxProposals = 6) {
  return { type: 'object', additionalProperties: false, required: ['proposals'], properties: {
    proposals: { type: 'array', maxItems: maxProposals, items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['kind', 'tactic'], properties: {
        kind: { type: 'string', enum: ['tactic'] }, tactic: { type: 'string' },
      } },
      { type: 'object', additionalProperties: false, required: ['kind', 'name', 'type'], properties: {
        kind: { type: 'string', enum: ['have'] }, name: { type: 'string' }, type: { type: 'string' },
      } },
    ] } },
  } };
}

export function buildProofPrompt(context, maxProposals = 6) {
  if (!plainObject(context) || !plainObject(context.goal) || typeof context.goal.target !== 'string' ||
      !Array.isArray(context.goal.hypotheses) || !Array.isArray(context.imports))
    throw new ProposerError('invalid_context', 'The proposer requires one Lean goal and its local context.', { modelTokens: 0 });
  const request = {
    goal: context.goal,
    imports: context.imports,
    feedback: (context.feedback ?? []).map(item => ({
      proposal: item.proposal, failure: item.failure,
      diagnostics: (item.diagnostics ?? []).map(d => ({ severity: d.severity, category: d.category,
        message: d.message, start: d.start, end: d.end })),
    })),
    budget: context.budget,
  };
  return `You are a Lean 4.24 proof-proposal function. Return only the requested JSON object.
Use the supplied current goal, its hypotheses, imports, and node-local compiler feedback.
You have no authority to edit the theorem, imports, options, declarations, or verification rules.
Do not use tools, files, searches, network requests, other agents, or benchmark answer modules.
Return at most ${maxProposals} ordered alternatives. Lean, not your confidence, decides success.
A tactic proposal is {"kind":"tactic","tactic":"..."}; its text is a tactic body, without a surrounding theorem or initial by.
For a useful intermediate lemma, prefer {"kind":"have","name":"fresh_name","type":"the local lemma type"}; the engine recursively proves that lemma and its continuation.
Use ordinary trusted Lean/Mathlib reasoning and only the supplied imports. When feedback rejects a proposal, change the proof strategy instead of repeating it.
Never use sorry, admit, extra axioms, unsafe/native evaluation, run_tac, elaborator commands, comments, quoted identifiers, or declaration injection.
Do not claim a proof is verified, invent token usage, or change a hypothesis. An empty proposals array is permitted if no sound suggestion is available.
If a local name is inaccessible, a rename_i tactic may give it an ordinary usable name.

CURRENT GOAL REQUEST
${JSON.stringify(request)}\n`;
}

/** Parse actual Codex JSONL telemetry, never a model's claimed usage. */
export function parseCodexCompletion(stdout, { maxProposals = 6 } = {}) {
  const events = [];
  let malformed = false;
  for (const line of stdout.split('\n').filter(x => x.trim())) {
    try { const event = JSON.parse(line); if (!plainObject(event) || typeof event.type !== 'string') malformed = true; else events.push(event); }
    catch { malformed = true; }
  }
  const completed = events.filter(e => e.type === 'turn.completed');
  let usage = null, modelTokens = null;
  if (completed.length && completed.every(e => plainObject(e.usage) && integer(e.usage.input_tokens) &&
      integer(e.usage.output_tokens) && integer(e.usage.cached_input_tokens ?? 0) &&
      (e.usage.cached_input_tokens ?? 0) <= e.usage.input_tokens)) {
    usage = completed.reduce((sum, e) => ({
      input_tokens: sum.input_tokens + e.usage.input_tokens,
      output_tokens: sum.output_tokens + e.usage.output_tokens,
      cached_input_tokens: sum.cached_input_tokens + (e.usage.cached_input_tokens ?? 0),
    }), { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0 });
    usage.reasoning_output_tokens = completed.every(e => integer(e.usage.reasoning_output_tokens))
      ? completed.reduce((sum, e) => sum + e.usage.reasoning_output_tokens, 0) : null;
    modelTokens = usage.input_tokens + usage.output_tokens;
    if (!integer(modelTokens)) { usage = null; modelTokens = null; }
  }
  const metadata = { eventTypes: [...new Set(events.map(e => e.type))], responseDigest: digest(stdout),
    providerErrors: events.filter(e => e.type === 'turn.failed' || e.type === 'error')
      .map(e => ({ type: e.type, diagnostic: diagnosticExcerpt(JSON.stringify(e.error ?? e.message ?? null)) })).slice(0, 8) };
  const details = { usage, modelTokens, metadata };
  if (malformed) throw new ProposerError('invalid_provider_output', 'Codex emitted malformed JSONL.', details);
  const toolItems = events.filter(e => e.type.startsWith('item.') && e.item &&
    !['agent_message', 'reasoning'].includes(e.item.type));
  if (toolItems.length) throw new ProposerError('unexpected_tool_use', 'A proof proposer attempted to use tools.', {
    ...details, metadata: { ...metadata, itemTypes: [...new Set(toolItems.map(e => e.item.type))] },
  });
  if (events.some(e => e.type === 'turn.failed' || e.type === 'error'))
    throw new ProposerError('provider_request_failed', 'Codex reported an unsuccessful model request.', details);
  if (completed.length !== 1 || modelTokens === null)
    throw new ProposerError('missing_provider_usage', 'A single completed Codex turn with actual token usage is required.', details);
  const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message');
  const final = messages.filter(e => e.item.phase === 'final');
  const message = (final.length ? final : messages).at(-1);
  let response;
  try { response = JSON.parse(message?.item?.text); }
  catch { throw new ProposerError('invalid_proposal_json', 'Codex did not return a JSON proposal object.', details); }
  if (!plainObject(response) || Object.keys(response).some(k => k !== 'proposals') ||
      !Array.isArray(response.proposals) || response.proposals.length > maxProposals)
    throw new ProposerError('invalid_proposal_schema', 'Codex returned an invalid proposal envelope.', details);
  for (const p of response.proposals) {
    const keys = p?.kind === 'have' ? ['kind', 'name', 'type'] : ['kind', 'tactic'];
    if (!plainObject(p) || !['tactic', 'have'].includes(p.kind) || Object.keys(p).length !== keys.length ||
        keys.some(k => typeof p[k] !== 'string' || !p[k].trim()) || Object.keys(p).some(k => !keys.includes(k)))
      throw new ProposerError('invalid_proposal_schema', 'Codex returned a malformed tactic or sublemma proposal.', details);
  }
  return { proposals: response.proposals, modelTokens, usage, metadata };
}

/** A fresh, tool-restricted Codex CLI turn per local proof goal. */
export function makeCodexProposer({ command = 'codex', commandArgs = [], model, timeoutMs = 60000,
  maxProposals = 6, maxOutputBytes = 262144, temporaryRoot = os.tmpdir() } = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(commandArgs) || commandArgs.some(x => typeof x !== 'string') ||
      (model !== undefined && (typeof model !== 'string' || !model.trim())) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxProposals) || maxProposals < 1 || maxProposals > 16 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || typeof temporaryRoot !== 'string')
    throw new TypeError('Invalid Codex proposer configuration');
  let discovery;
  const pendingCleanup = new Set();
  async function discover(cwd, remaining) {
    const version = await runProcess(command, [...commandArgs, '--version'], { cwd, timeoutMs: Math.min(10000, remaining()), maxOutputBytes: 4096 });
    if (version.exitCode !== 0 || version.timedOut || version.launchError || version.truncated)
      throw new ProposerError('provider_unavailable', 'Codex CLI is unavailable; install it and authenticate with codex login.', { modelTokens: 0 });
    const inventory = await runProcess(command, [...commandArgs, 'mcp', 'list', '--json'], { cwd, timeoutMs: Math.min(10000, remaining()), maxOutputBytes: 262144 });
    let servers;
    try { servers = JSON.parse(inventory.stdout); } catch { servers = null; }
    if (inventory.exitCode !== 0 || inventory.timedOut || inventory.truncated || !Array.isArray(servers) ||
        servers.some(s => !plainObject(s) || typeof s.name !== 'string'))
      throw new ProposerError('provider_configuration', 'Could not inspect Codex MCP configuration to restrict proposer tools.', { modelTokens: 0 });
    return { version: version.stdout.trim(), servers: servers.map(s => s.name) };
  }
  const proposer = async context => {
    if (!integer(context?.budget?.modelTokensRemaining) || context.budget.modelTokensRemaining === 0)
      throw new ProposerError('model_token_budget', 'A positive model-token allowance is required for Codex.', { modelTokens: 0 });
    const start = performance.now();
    const limit = Math.min(timeoutMs, context.budget.remainingMs ?? timeoutMs);
    if (!Number.isFinite(limit) || limit <= 0)
      throw new ProposerError('provider_timeout', 'No time remains for a model request.', { modelTokens: 0 });
    const remaining = () => Math.max(1, Math.floor(limit - (performance.now() - start)));
    const prompt = buildProofPrompt(context, maxProposals);
    let directory;
    try { directory = await mkdtemp(path.join(temporaryRoot, 'fva-codex-')); }
    catch (error) { throw new ProposerError('provider_configuration', `Cannot create proposer runtime directory: ${error.message}`, { modelTokens: 0 }); }
    pendingCleanup.add(directory);
    let launched = false;
    let measuredResult;
    const metadata = { provider: 'codex-cli', model: model ?? null, modelSelection: model ? 'explicit' : 'codex-configured-default',
      promptDigest: digest(prompt), promptVersion: 1, toolPolicy: 'disabled', ephemeral: true };
    try {
      discovery ??= discover(directory, remaining).catch(error => { discovery = undefined; throw error; });
      const config = await discovery;
      metadata.cliVersion = config.version;
      const schemaFile = path.join(directory, 'proposal-schema.json');
      await writeFile(schemaFile, JSON.stringify(proposalSchema(maxProposals)), { flag: 'wx', mode: 0o600 });
      const args = [...commandArgs, 'exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', directory,
        '--disable', 'shell_tool', '--disable', 'shell_snapshot', '--disable', 'apps', '--disable', 'plugins', '--disable', 'remote_plugin',
        '--disable', 'multi_agent', '--config', 'web_search="disabled"',
        '--config', `sqlite_home=${JSON.stringify(path.join(directory, 'state'))}`,
        '--config', `log_dir=${JSON.stringify(path.join(directory, 'log'))}`,
        '--output-schema', schemaFile];
      for (const name of config.servers) args.push('--config', `mcp_servers.${JSON.stringify(name)}.enabled=false`);
      if (model) args.push('--model', model);
      args.push('-');
      if (performance.now() - start >= limit)
        throw new ProposerError('provider_timeout', 'Codex initialization exhausted the proposal time limit.', { modelTokens: 0 });
      launched = true;
      const raw = await runProcess(command, args, { cwd: directory, timeoutMs: remaining(), maxOutputBytes, input: prompt });
      let parsed, parseError;
      try { parsed = parseCodexCompletion(raw.stdout, { maxProposals }); } catch (error) { parseError = error; }
      const measured = parsed ?? parseError ?? {};
      measuredResult = measured;
      Object.assign(metadata, measured.metadata, { elapsedMs: Math.round(performance.now() - start),
        exitCode: raw.exitCode, signal: raw.signal, stdoutDigest: digest(raw.stdout), stderrDigest: digest(raw.stderr),
        stderrDiagnostic: diagnosticExcerpt(raw.stderr) });
      if (raw.exitCode !== 0 || raw.timedOut || raw.launchError || raw.truncated) {
        const readOnly = /[Rr]ead-only file system/.test(raw.stderr);
        throw new ProposerError(raw.timedOut ? 'provider_timeout' : raw.truncated ? 'provider_output_limit' :
          readOnly ? 'provider_runtime_read_only' : 'provider_process_failed',
        readOnly ? 'Codex could not initialize its runtime on the current read-only filesystem.' :
          'Codex did not complete a bounded proof-proposal request.',
        { usage: measured.usage ?? null, modelTokens: measured.modelTokens ?? null, metadata });
      }
      if (parseError) { Object.assign(parseError, { metadata }); throw parseError; }
      return { ...parsed, provider: 'codex-cli', policy: 'codex-v1', metadata };
    } catch (error) {
      if (error instanceof ProposerError) { error.metadata = { ...metadata, ...error.metadata }; throw error; }
      throw new ProposerError('provider_configuration', error.message, { metadata, modelTokens: launched ? null : 0 });
    } finally {
      try { await rm(directory, { recursive: true, force: true }); pendingCleanup.delete(directory); }
      catch (error) {
        metadata.cleanup = { status: 'failed', directory, message: error.message };
        throw new ProposerError('provider_cleanup', 'The owned proposer directory could not be removed; retryCleanup retains its ownership.',
          { metadata, usage: measuredResult?.usage ?? null, modelTokens: measuredResult?.modelTokens ?? (launched ? null : 0) });
      }
    }
  };
  proposer.policy = 'codex-v1';
  // A cleanup failure does not erase known spend or discard the exact owned path.
  // The configured proposer remains the owner; callers can retry without relaunching a model.
  proposer.retryCleanup = async () => {
    const results = [];
    for (const directory of pendingCleanup) {
      try { await rm(directory, { recursive: true, force: true }); pendingCleanup.delete(directory); results.push({ directory, status: 'closed' }); }
      catch (error) { results.push({ directory, status: 'failed', message: error.message }); }
    }
    return results;
  };
  return proposer;
}
