import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProofPrompt, makeCodexProposer, parseCodexCompletion } from '../src/codex-proposer.mjs';

const fixture = fileURLToPath(new URL('./fixtures/codex-cli.mjs', import.meta.url));
const context = { goal: { target: 'True', targetHead: 'True', hypotheses: [], universe_parameters: [] },
  imports: ['Init'], feedback: [], budget: { remainingMs: 5000, modelTokensRemaining: 1000 } };
const completion = (text = JSON.stringify({ proposals: [{ kind: 'have', name: 'h', type: 'True' }] })) => [
  { type: 'item.completed', item: { type: 'agent_message', phase: 'final', text } },
  { type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 150, output_tokens: 30 } },
];
const jsonl = events => events.map(JSON.stringify).join('\n') + '\n';

test('Codex prompt contains only scoped context and node-local compiler feedback', () => {
  const prompt = buildProofPrompt({ ...context, parentSource: 'PRIVATE_PARENT_SOURCE', benchmarkId: 'ANSWER_INDEX',
    feedback: [{ proposal: { tactic: 'rfl' }, failure: 'type_mismatch',
      diagnostics: [{ severity: 'error', message: 'type mismatch', file: '/SECRET_PARENT_PATH', start: { line: 7, column: 2 } }] }] });
  assert.match(prompt, /type mismatch/);
  assert.match(prompt, /"target":"True"/);
  assert.doesNotMatch(prompt, /PRIVATE_PARENT_SOURCE|ANSWER_INDEX|SECRET_PARENT_PATH/);
});

test('actual provider usage includes cached input once and preserves structured have', () => {
  const result = parseCodexCompletion(jsonl(completion()));
  assert.equal(result.modelTokens, 230);
  assert.equal(result.usage.cached_input_tokens, 150);
  assert.equal(result.usage.reasoning_output_tokens, null);
  assert.deepEqual(result.proposals, [{ kind: 'have', name: 'h', type: 'True' }]);
});

test('malformed JSON/schema never erases actual spend or accepts self-reported spend', () => {
  for (const body of ['bad JSON', '{"proposals":[],"modelTokens":0}', '{"proposals":[{"kind":"tactic","tactic":42}]}']) {
    assert.throws(() => parseCodexCompletion(jsonl(completion(body))), error => {
      assert.equal(error.modelTokens, 230); assert.equal(error.usage.input_tokens, 200); return true;
    });
  }
  assert.throws(() => parseCodexCompletion('broken\n' + jsonl(completion())), error => error.code === 'invalid_provider_output' && error.modelTokens === 230);
});

test('tool events, duplicate turns and absent telemetry are explicit refusals', () => {
  assert.throws(() => parseCodexCompletion(jsonl([{ type: 'item.completed', item: { type: 'command_execution' } }, ...completion()])),
    error => error.code === 'unexpected_tool_use' && error.modelTokens === 230);
  assert.throws(() => parseCodexCompletion(jsonl([...completion(), ...completion()])),
    error => error.code === 'missing_provider_usage' && error.modelTokens === 460);
  assert.throws(() => parseCodexCompletion(jsonl(completion().slice(0, 1))),
    error => error.code === 'missing_provider_usage' && error.modelTokens === null);
  assert.throws(() => parseCodexCompletion(jsonl([{ type: 'turn.failed', error: { message: 'unavailable' } }])),
    error => error.code === 'provider_request_failed' && error.modelTokens === null && error.metadata.providerErrors[0].diagnostic.includes('unavailable'));
});

test('provider error excerpts redact the full Bearer credential alphabet', () => {
  assert.throws(() => parseCodexCompletion(jsonl([{ type: 'error', message: 'Authorization: Bearer DEMO/opaque+suffix==' }])), error => {
    const diagnostic = error.metadata.providerErrors[0].diagnostic;
    assert.match(diagnostic, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(diagnostic, /DEMO|opaque|suffix/);
    return true;
  });
});

test('fixture CLI uses separate ephemeral directory, no tools and measured output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fva-provider-test-'));
  try {
    const capture = path.join(root, 'capture.json');
    const proposer = makeCodexProposer({ command: process.execPath, commandArgs: [fixture, 'success', capture], temporaryRoot: root, model: 'fixture-model' });
    const result = await proposer(context);
    assert.equal(result.modelTokens, 140);
    assert.equal(result.usage.reasoning_output_tokens, 5);
    assert.equal(result.metadata.cliVersion, 'codex-cli TEST-FIXTURE');
    assert.equal(result.metadata.model, 'fixture-model');
    const request = JSON.parse(await readFile(capture, 'utf8'));
    assert.notEqual(request.cwd, process.cwd());
    assert.ok(request.args.includes('mcp_servers."configured.server".enabled=false'));
    assert.ok(request.args.includes('shell_tool') && request.args.includes('read-only') && request.args.includes('--ephemeral'));
    assert.equal(request.args.at(-1), '-');
    assert.ok(request.args.every(arg => !arg.includes('CODEX_HOME')));
    assert.deepEqual(await readdir(root), ['capture.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('provider startup block, invalid response and timeout retain honest usage and clean up', async () => {
  for (const [mode, code, tokens] of [['readonly', 'provider_runtime_read_only', null],
    ['malformed', 'invalid_proposal_json', 140], ['timeout', 'provider_timeout', null]]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fva-provider-failure-'));
    try {
      const proposer = makeCodexProposer({ command: process.execPath, commandArgs: [fixture, mode, path.join(root, 'capture.json')],
        temporaryRoot: root, timeoutMs: mode === 'timeout' ? 500 : 5000 });
      await assert.rejects(proposer(context), error => error.code === code && error.modelTokens === tokens);
      assert.deepEqual(await readdir(root), ['capture.json']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('missing model allowance and expired deadline stop before provider execution', async () => {
  const proposer = makeCodexProposer({ command: '/a/nonexistent/provider' });
  await assert.rejects(proposer({ ...context, budget: { modelTokensRemaining: 0, remainingMs: 1000 } }), error => error.code === 'model_token_budget' && error.modelTokens === 0);
  await assert.rejects(proposer({ ...context, budget: { modelTokensRemaining: 10, remainingMs: 0 } }), error => error.code === 'provider_timeout' && error.modelTokens === 0);
});

test('prelaunch directory failure is known zero usage', async () => {
  const proposer = makeCodexProposer({ temporaryRoot: '/this/parent/does/not/exist' });
  await assert.rejects(proposer(context), error => error.code === 'provider_configuration' && error.modelTokens === 0);
});

test('cleanup permission failure preserves usage and an exact retry owner', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fva-cleanup-owner-'));
  let owned;
  try {
    const proposer = makeCodexProposer({ command: process.execPath, commandArgs: [fixture, 'cleanup', path.join(root, 'capture.json')], temporaryRoot: root });
    await assert.rejects(proposer(context), error => {
      assert.equal(error.code, 'provider_cleanup'); assert.equal(error.modelTokens, 140);
      owned = error.metadata.cleanup.directory;
      return true;
    });
    assert.equal((await proposer.retryCleanup())[0].status, 'failed');
    await chmod(owned, 0o700);
    assert.deepEqual(await proposer.retryCleanup(), [{ directory: owned, status: 'closed' }]);
    assert.deepEqual(await proposer.retryCleanup(), []);
  } finally {
    if (owned) await chmod(owned, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

