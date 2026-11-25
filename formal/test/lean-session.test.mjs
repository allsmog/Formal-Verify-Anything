import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLeanSession } from '../src/lean-session.mjs';
import { compileLean, observationFor } from '../src/compiler.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/lean-worker.mjs', import.meta.url));
const integration = { skip: process.env.FVA_INTEGRATION !== '1', timeout: 150000 };

async function fixtureSession(t, args = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-worker-'));
  await mkdir(path.join(directory, 'FormalVerify'), { recursive: true });
  await mkdir(path.join(directory, '.lake/build/lib/lean/FormalVerify'), { recursive: true });
  for (const [name, contents] of [
    ['lean-toolchain', 'leanprover/lean4:v4.24.0\n'], ['lakefile.toml', 'name = "fixture"'], ['lake-manifest.json', '{}'],
    ['FormalVerify/Worker.lean', 'worker'], ['FormalVerify/Bridge.lean', 'bridge'],
    ['.lake/build/lib/lean/FormalVerify/Bridge.olean', 'artifact'],
  ]) await writeFile(path.join(directory, name), contents);
  const session = createLeanSession({ projectRoot: directory, workerCommand: [process.execPath, fixture, ...args] });
  t.after(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  return { session, directory };
}

const attempt = (session, source, extra = {}) => session.compile({
  sourceFile: 'candidate.lean', source, timeoutMs: 2000, ...extra,
});

// Synchronous elaboration and the CLI's asynchronous elaboration allocate one
// different private metavariable. Compare states up to alpha-renaming while
// preserving every local dependency, binder, type, and visible proof state.
function semanticStates(states) {
  return states.map(state => ({ ...state, goals: state.goals.map((goal, goalIndex) => {
    const ids = new Map(goal.hypotheses.map((hypothesis, index) => [hypothesis.id, `local${index}`]));
    return { ...goal, id: `goal${goalIndex}`, hypotheses: goal.hypotheses.map(hypothesis => ({
      ...hypothesis, id: ids.get(hypothesis.id), dependencies: hypothesis.dependencies.map(id => ids.get(id) ?? id),
    })) };
  }) }));
}

test('persistent transport rejects failures, owns cleanup, and restarts only on the next request', async t => {
  const { session } = await fixtureSession(t);
  let good = await attempt(session, 'good');
  assert.equal(good.exitCode, 0);
  assert.equal(good.backendMetadata.generation, 1);
  for (const [source, code, options] of [
    ['hang', 'worker_timeout', { timeoutMs: 100 }],
    ['crash', 'worker_crash', {}],
    ['malformed', 'worker_protocol', {}],
    ['malformed-utf8', 'worker_protocol', {}],
    ['wrong-id', 'worker_protocol', {}],
    ['inconsistent', 'worker_protocol', {}],
    ['stderr', 'worker_stderr', {}],
    ['overflow', 'worker_output_limit', { maxOutputBytes: 128 }],
  ]) {
    const failed = await attempt(session, source, options);
    assert.equal(failed.exitCode, null, source);
    assert.equal(failed.failureCode, code, JSON.stringify(failed));
    assert.equal(failed.backendMetadata.generation, good.backendMetadata.generation);
    assert.equal(failed.backendMetadata.restarts, good.backendMetadata.restarts);
    assert.equal(failed.states.length, 0);
    const restarted = await attempt(session, 'good');
    assert.equal(restarted.exitCode, 0, JSON.stringify(restarted));
    assert.equal(restarted.backendMetadata.generation, good.backendMetadata.generation + 1);
    good = restarted;
  }
  const error = await attempt(session, 'error');
  assert.equal(error.exitCode, 1);
  assert.equal(error.launchError, null);
  assert.deepEqual(error.diagnostics[0].start, { line: 3, column: 2 });
  assert.equal(error.diagnostics[0].category, 'unknown_tactic_or_identifier');
});

test('startup timeout rejects a late handshake and the next generation can complete', async t => {
  const { session } = await fixtureSession(t, ['250']);
  const timedOut = await attempt(session, 'good', { timeoutMs: 50 });
  assert.equal(timedOut.timedOut, true);
  const result = await attempt(session, 'good');
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.backendMetadata.generation, 2);
});

test('session serializes concurrent requests, invalidates changed inputs, and closes pending work', async t => {
  const { session, directory } = await fixtureSession(t);
  const results = await Promise.all([attempt(session, 'good'), attempt(session, 'error')]);
  assert.deepEqual(results.map(result => result.exitCode), [0, 1]);
  assert.deepEqual(results.map(result => result.backendMetadata.requestId), [1, 2]);
  assert.equal(results[0].backendMetadata.generation, results[1].backendMetadata.generation);
  await writeFile(path.join(directory, 'FormalVerify/Bridge.lean'), 'changed bridge');
  const changed = await attempt(session, 'good');
  assert.equal(changed.exitCode, 0);
  assert.equal(changed.backendMetadata.generation, 2);
  assert.notEqual(changed.backendMetadata.environmentFingerprint, results[0].backendMetadata.environmentFingerprint);
  await session.suspend();
  const resumed = await attempt(session, 'good');
  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.backendMetadata.generation, 3);
  const pending = attempt(session, 'hang');
  await new Promise(resolve => setTimeout(resolve, 30));
  await session.close();
  const cancelled = await pending;
  assert.equal(cancelled.failureCode, 'worker_closed');
  assert.equal((await attempt(session, 'good')).failureCode, 'worker_closed');
  await session.close();
});

test('timeout kills the owned worker process group including its live child', { skip: process.platform === 'win32' }, async t => {
  const { session, directory } = await fixtureSession(t);
  const childFile = path.join(directory, 'child.pid');
  await attempt(session, 'good');
  const result = await attempt(session, `child:${childFile}`, { timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  const pid = Number(await readFile(childFile, 'utf8'));
  let alive = false;
  try {
    const status = await readFile(`/proc/${pid}/stat`, 'utf8');
    // A reparented zombie has exited and cannot continue executing work.
    alive = !/\) [ZX] /.test(status);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(alive, false, `worker descendant ${pid} remained live`);
});

test('real Lean worker matches native observations and isolates declarations, errors, scopes, and imports', integration, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fva-worker-real-'));
  const session = createLeanSession({ projectRoot });
  t.after(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  const imports = 'import Mathlib.Data.Real.Basic\nimport Mathlib.Tactic.NormNum\nimport Mathlib.Tactic.Linarith.Frontend\nimport FormalVerify.Bridge\n';
  const source = imports + 'theorem worker_goal (a : ℝ) (h : 2 * a + 3 = 7) : a = 2 := by\n  fva_probe "root"\n';
  const sourceFile = path.join(directory, 'Probe.lean');
  await writeFile(sourceFile, source);
  const fresh = await compileLean(projectRoot, sourceFile, { timeoutMs: 30000 });
  const cold = await session.compile({ sourceFile, source, timeoutMs: 60000 });
  t.diagnostic(`cold worker ${cold.elapsedMs} ms; fresh CLI ${fresh.elapsedMs} ms`);
  assert.equal(observationFor(cold, 'root', ['root']).valid, true, JSON.stringify(cold));
  assert.equal(observationFor(fresh, 'root', ['root']).valid, true, JSON.stringify(fresh));
  assert.deepEqual(semanticStates(cold.states), semanticStates(fresh.states));
  assert.deepEqual(cold.diagnostics.filter(item => !item.message.startsWith('FVA_STATE:')),
    fresh.diagnostics.filter(item => !item.message.startsWith('FVA_STATE:')));
  assert.equal(cold.backendMetadata.cacheHit, false);
  const warm = await session.compile({ sourceFile, source, timeoutMs: 30000 });
  assert.deepEqual(semanticStates(warm.states), semanticStates(fresh.states));
  assert.equal(warm.backendMetadata.cacheHit, true);
  assert.equal(warm.backendMetadata.generation, cold.backendMetadata.generation);

  const declared = await session.compile({ sourceFile, source: imports + 'def session_private : Nat := 37\n', timeoutMs: 30000 });
  assert.equal(declared.exitCode, 0, JSON.stringify(declared));
  const leaked = await session.compile({ sourceFile, source: imports + '#check session_private\n', timeoutMs: 30000 });
  assert.equal(leaked.exitCode, 1);
  assert.ok(leaked.diagnostics.some(message => /Unknown identifier|unknown identifier/.test(message.message)));

  const failed = await session.compile({ sourceFile, source: source.replace('fva_probe "root"', 'this_tactic_does_not_exist\n  fva_probe "root"'), timeoutMs: 30000 });
  assert.equal(observationFor(failed, 'root', ['root']).valid, false);
  const closedSource = source.replace('fva_probe "root"', 'linarith\n  fva_done "root"');
  const closed = await session.compile({ sourceFile, source: closedSource, timeoutMs: 30000 });
  assert.deepEqual(observationFor(closed, 'root', ['root']), { valid: true, goals: [] });

  const scoped = await session.compile({ sourceFile,
    source: imports + 'namespace Ephemeral\ndef localValue : Nat := 0\n', timeoutMs: 30000 });
  assert.equal(scoped.exitCode, 0, JSON.stringify(scoped));
  const restored = await session.compile({ sourceFile, source, timeoutMs: 30000 });
  assert.deepEqual(semanticStates(restored.states), semanticStates(fresh.states));

  const reduced = await session.compile({ sourceFile,
    source: 'import FormalVerify.Bridge\ntheorem no_import_leak : True := by norm_num\n', timeoutMs: 30000 });
  assert.equal(reduced.backendMetadata.cacheHit, false);
  assert.equal(reduced.exitCode, 1);
  assert.ok(reduced.diagnostics.some(message => message.category === 'unknown_tactic_or_identifier'));
});
