import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { OutputExcerpt } from './support.mjs';
import { parseLeanOutput } from './compiler.mjs';
import { killOwnedGroup } from './process-group.mjs';

const BACKEND = 'lean-persistent-v1';
const PROTOCOL = 1;
const DEFAULT_OUTPUT_BYTES = 1048576;
const MAX_SOURCE_BYTES = 4 * 1048576;
const PROTOCOL_OVERHEAD_BYTES = 65536;

const digest = value => createHash('sha256').update(value).digest('hex');
const deferred = () => Promise.withResolvers();
const positive = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class WorkerFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Owns one sequential Lean process and its imported-library cache. Sources must
 * already have passed the engine's scaffold/proposal guards. This is an
 * exploration transport, never a replacement for final CLI verification.
 *
 * workerCommand, when supplied, is a trusted local argv override (also used by
 * the transport regression fixtures); it is never interpreted by a shell.
 */
export function createLeanSession({ projectRoot, lake = 'lake', maxOutputBytes = DEFAULT_OUTPUT_BYTES,
  workerCommand } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot) throw new TypeError('projectRoot is required');
  if (!positive(maxOutputBytes)) throw new TypeError('maxOutputBytes must be a positive safe integer');
  const command = workerCommand ?? [lake, 'env', 'lean', '-j1', '-M2048', '--run', 'FormalVerify/Worker.lean'];
  if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string' || !x))
    throw new TypeError('workerCommand must be a nonempty argv array');
  return new LeanSession(path.resolve(projectRoot), command, maxOutputBytes);
}

class LeanSession {
  constructor(projectRoot, command, maxOutputBytes) {
    this.projectRoot = projectRoot;
    this.command = [...command];
    this.maxOutputBytes = maxOutputBytes;
    this.worker = null;
    this.generation = 0;
    this.requestId = 0;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  compile(options) {
    const work = this.queue.then(() => this.compileOne(options));
    this.queue = work.catch(() => {});
    return work;
  }

  // Release the resident import environment before fresh CLI verification.
  // A rejected final proof may subsequently resume exploration in a new worker.
  suspend() {
    const work = this.queue.then(() => this.stopWorker(this.worker));
    this.queue = work.catch(() => {});
    return work;
  }

  async environmentStamp() {
    const files = ['lean-toolchain', 'lakefile.toml', 'lake-manifest.json', 'FormalVerify/Worker.lean', 'FormalVerify/Bridge.lean'];
    const contents = await Promise.all(files.map(file => readFile(path.join(this.projectRoot, file))));
    const artifact = await stat(path.join(this.projectRoot, '.lake/build/lib/lean/FormalVerify/Bridge.olean'), { bigint: true });
    const environmentNames = ['PATH', 'LEAN_PATH', 'LEAN_SYSROOT', 'ELAN_TOOLCHAIN', 'ELAN_HOME', 'LAKE_HOME'];
    // Hash selected launch inputs without persisting ambient environment values.
    const fingerprint = digest(JSON.stringify({
      files: Object.fromEntries(files.map((file, index) => [file, digest(contents[index])])),
      environment: Object.fromEntries(environmentNames.map(name => [name, process.env[name] ?? null])),
      bridgeArtifact: `${artifact.dev}:${artifact.ino}:${artifact.size}:${artifact.mtimeNs}:${artifact.ctimeNs}`,
    }));
    const toolchain = contents[0].toString('utf8').trim();
    const version = /^leanprover\/lean4:v([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$/.exec(toolchain)?.[1];
    if (!version) throw new WorkerFailure('worker_environment', 'A pinned release Lean toolchain is required');
    return { fingerprint, leanVersion: version };
  }

  killOwned(worker) {
    // Never signal a numerical PID after its child exit event: it may have
    // been reused. The unreaped ChildProcess is the ownership witness.
    if (worker.exited || !worker.child.pid) return;
    try { killOwnedGroup(worker.child); } catch (error) { worker.cleanupError = error; }
  }

  fail(worker, code, message) {
    if (!worker.failure) worker.failure = new WorkerFailure(code, message);
    worker.ready.reject(worker.failure);
    worker.pending?.reject(worker.failure);
    this.killOwned(worker);
  }

  startWorker(stamp, limit) {
    const child = spawn(this.command[0], this.command.slice(1), {
      cwd: this.projectRoot, shell: false, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const worker = {
      child, generation: ++this.generation, fingerprint: stamp.fingerprint,
      leanVersion: stamp.leanVersion, ready: deferred(), completion: deferred(),
      handshake: false, exited: false, closed: false, pending: null, failure: null,
      buffer: Buffer.alloc(0), wireBytes: 0, limit,
      wire: new OutputExcerpt(limit), stderr: new OutputExcerpt(limit),
    };
    this.worker = worker;
    // A failed launch may precede the caller beginning to await the handshake.
    worker.ready.promise.catch(() => {});
    child.stdout.on('data', chunk => {
      worker.wire.append(chunk);
      worker.wireBytes += chunk.length;
      if (worker.wireBytes > worker.limit + PROTOCOL_OVERHEAD_BYTES) {
        this.fail(worker, 'worker_output_limit', 'Lean worker exceeded the output byte limit');
        return;
      }
      worker.buffer = Buffer.concat([worker.buffer, chunk]);
      let newline;
      while ((newline = worker.buffer.indexOf(10)) !== -1 && !worker.failure) {
        let line;
        try { line = new TextDecoder('utf-8', { fatal: true }).decode(worker.buffer.subarray(0, newline)); }
        catch { this.fail(worker, 'worker_protocol', 'Lean worker returned malformed UTF-8'); return; }
        worker.buffer = worker.buffer.subarray(newline + 1);
        this.receive(worker, line);
      }
    });
    child.stderr.on('data', chunk => {
      worker.stderr.append(chunk);
      this.fail(worker, 'worker_stderr', 'Lean worker wrote unexpected standard error');
    });
    child.stdin.on('error', error => this.fail(worker, 'worker_transport', `Lean worker input failed: ${error.message}`));
    child.on('error', error => this.fail(worker, 'worker_launch', `Lean worker launch failed: ${error.message}`));
    child.on('exit', (code, signal) => {
      worker.exited = true;
      worker.exitCode = code;
      worker.signal = signal;
      if (!worker.stopping) this.fail(worker, 'worker_crash', `Lean worker exited (${code ?? signal ?? 'unknown'})`);
    });
    child.on('close', (code, signal) => {
      worker.exited = true;
      worker.closed = true;
      worker.exitCode = code;
      worker.signal = signal;
      worker.completion.resolve();
    });
    return worker;
  }

  receive(worker, line) {
    let message;
    try { message = JSON.parse(line); }
    catch { this.fail(worker, 'worker_protocol', 'Lean worker returned malformed JSON'); return; }
    if (!record(message) || message.protocol !== PROTOCOL) {
      this.fail(worker, 'worker_protocol', 'Lean worker returned an invalid protocol frame'); return;
    }
    if (!worker.handshake) {
      if (message.type !== 'ready' || message.leanVersion !== worker.leanVersion) {
        this.fail(worker, 'worker_protocol', 'Lean worker handshake or pinned Lean version did not match'); return;
      }
      worker.handshake = true;
      worker.ready.resolve();
      return;
    }
    if (message.type === 'fatal') {
      this.fail(worker, 'worker_internal', `Lean worker failed: ${String(message.message)}`); return;
    }
    if (message.type !== 'result' || !worker.pending || message.id !== worker.pending.id ||
        ![0, 1].includes(message.exitCode) || !Array.isArray(message.messages) ||
        typeof message.truncated !== 'boolean' || typeof message.cacheHit !== 'boolean' ||
        !Number.isSafeInteger(message.importMs) || message.importMs < 0 ||
        !Number.isSafeInteger(message.elaborationMs) || message.elaborationMs < 0 ||
        !Number.isSafeInteger(message.artifactCount) || message.artifactCount < 0) {
      this.fail(worker, 'worker_protocol', 'Lean worker returned an invalid or out-of-order result'); return;
    }
    worker.pending.resolve(message);
    worker.pending = null;
  }

  async stopWorker(worker) {
    if (!worker) return;
    worker.stopping = true;
    this.killOwned(worker);
    worker.child.stdin.destroy();
    let timer;
    try {
      await Promise.race([
        worker.completion.promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new WorkerFailure('worker_cleanup',
          'Lean worker cleanup did not complete; its handle remains owned by the session')), 2000); }),
      ]);
    } finally { clearTimeout(timer); }
    if (worker.cleanupError) throw new WorkerFailure('worker_cleanup', worker.cleanupError.message);
    if (this.worker === worker) this.worker = null;
  }

  async compileOne({ sourceFile, source, timeoutMs = 30000, maxOutputBytes = this.maxOutputBytes } = {}) {
    const started = performance.now();
    const requestId = ++this.requestId;
    let worker = this.worker;
    let timedOut = false;
    let timer;
    const metadata = {
      requestId, generation: this.generation, restarts: Math.max(0, this.generation - 1),
      sourceSha256: typeof source === 'string' ? digest(source) : null,
    };
    const finish = raw => ({ ...raw, ...parseLeanOutput(raw.stdout), backend: BACKEND,
      backendMetadata: { ...metadata }, elapsedMs: Math.round(performance.now() - started) });
    const checkActive = () => {
      if (timedOut) throw new WorkerFailure('worker_timeout', 'Lean worker request timed out');
      if (this.closed) throw new WorkerFailure('worker_closed', 'Lean session is closed');
    };
    try {
      if (!positive(timeoutMs) || !positive(maxOutputBytes)) throw new TypeError('Positive time/output limits are required');
      if (typeof sourceFile !== 'string' || !sourceFile || typeof source !== 'string' ||
          Buffer.byteLength(source) > MAX_SOURCE_BYTES)
        throw new TypeError(`A source file and source text of at most ${MAX_SOURCE_BYTES} bytes are required`);
      checkActive();
      const operation = (async () => {
        const stamp = await this.environmentStamp();
        checkActive();
        if (this.worker && (this.worker.failure || this.worker.fingerprint !== stamp.fingerprint))
          await this.stopWorker(this.worker);
        checkActive();
        worker = this.worker ?? this.startWorker(stamp, maxOutputBytes);
        metadata.generation = worker.generation;
        metadata.restarts = worker.generation - 1;
        metadata.leanVersion = worker.leanVersion;
        metadata.environmentFingerprint = worker.fingerprint;
        await worker.ready.promise;
        checkActive();
        if (worker.failure) throw worker.failure;
        if (worker.buffer.length) throw new WorkerFailure('worker_protocol', 'Lean worker has incomplete unsolicited output');
        worker.limit = maxOutputBytes;
        worker.wireBytes = 0;
        worker.wire = new OutputExcerpt(maxOutputBytes);
        worker.stderr = new OutputExcerpt(maxOutputBytes);
        const response = deferred();
        worker.pending = { ...response, id: requestId };
        worker.child.stdin.write(JSON.stringify({ protocol: PROTOCOL, id: requestId, sourceFile, source, maxOutputBytes }) + '\n');
        const message = await response.promise;
        checkActive();
        if (worker.failure) throw worker.failure;
        const stdout = message.messages.map(item => JSON.stringify(item)).join('\n') + (message.messages.length ? '\n' : '');
        if (Buffer.byteLength(stdout) > maxOutputBytes)
          throw new WorkerFailure('worker_output_limit', 'Lean worker diagnostics exceeded the output byte limit');
        const parsed = parseLeanOutput(stdout);
        if (parsed.unparsed.length || (!message.truncated &&
            Number(parsed.diagnostics.some(item => item.severity === 'error')) !== message.exitCode))
          throw new WorkerFailure('worker_protocol', 'Lean worker diagnostics and exit status are inconsistent');
        Object.assign(metadata, { cacheHit: message.cacheHit, importMs: message.importMs,
          elaborationMs: message.elaborationMs, artifactCount: message.artifactCount });
        return finish({ exitCode: message.exitCode, signal: null, timedOut: false, launchError: null,
          stdout, stderr: worker.stderr.text, truncated: message.truncated });
      })();
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
        timedOut = true;
        if (worker) this.fail(worker, 'worker_timeout', 'Lean worker request timed out');
        reject(new WorkerFailure('worker_timeout', 'Lean worker request timed out'));
      }, timeoutMs); });
      return await Promise.race([operation, timeout]);
    } catch (error) {
      let failure = error;
      if (worker) {
        metadata.rawWorkerOutput = worker.wire.text;
        try { await this.stopWorker(worker); } catch (cleanupError) { failure = cleanupError; }
      }
      return finish({ exitCode: null, signal: worker?.signal ?? null, timedOut,
        launchError: failure.message, failureCode: failure.code ?? 'worker_environment',
        stdout: '', stderr: worker?.stderr.text ?? '',
        truncated: failure.code === 'worker_output_limit' || Boolean(worker?.stderr.truncated) });
    } finally { clearTimeout(timer); }
  }

  async close() {
    this.closed = true;
    if (this.worker) {
      this.fail(this.worker, 'worker_closed', 'Lean session closed during request');
      await this.stopWorker(this.worker);
    }
    await this.queue;
  }
}
