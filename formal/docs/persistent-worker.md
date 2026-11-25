# Persistent Lean exploration

The optional persistent backend reuses imported Lean environments during proof
search. Each candidate still parses and elaborates its complete source in a new
Lean command state. The two final verification calls always use independent
`lake env lean --json` processes. An exploratory worker response cannot mark a
theorem `SOLVED`.

## API and ownership

```js
import { createLeanSession } from './formal/src/lean-session.mjs';

const session = createLeanSession({
  projectRoot: '/absolute/path/to/Formal-Verify-Anything',
  lake: 'lake',
  maxOutputBytes: 1048576,
});

try {
  const observation = await session.compile({
    sourceFile: '/absolute/path/to/candidate.lean',
    source: completeSource,
    timeoutMs: 30000,
  });
  // Use the shared compiler observation validator, not exitCode alone.
} finally {
  await session.close();
}
```

`compile` returns the same diagnostics, goals, audit arrays, process outcome,
and transport-completeness fields as `compileLean`. It adds
`backend: 'lean-persistent-v1'` and `backendMetadata` containing the request and
worker generation, source digest, environment fingerprint, Lean version,
import-cache hit, artifact count, and import/elaboration timings. There are no
model calls in this adapter.

Pass `explorationSessionFactory: createLeanSession` to `solveTheorem` for an
engine-owned worker. The engine closes it in `finally`. An explicitly supplied
`explorationSession` remains caller-owned. The engine calls optional
`session.suspend()` before starting fresh final verification. Suspension ends
the worker process and releases its resident imported environment; the session
can start a new worker if rejected final verification causes more search.
`close()` is permanent and idempotent. Suspension or cleanup failure is
reported, and the session retains the child handle for a cleanup retry.

The default worker command is:

```sh
lake env lean -j1 -M2048 --run FormalVerify/Worker.lean
```

`workerCommand` can override this with an explicit trusted argv array. It is
used by the subprocess regression fixtures and can select a compatible local
worker deployment. No shell interprets it.

## What is cached

`FormalVerify/Worker.lean` parses each request's import header and caches one
imported environment keyed by the exact module/import flags and order. It does
not cache a theorem's command state, local hypotheses, metavariables, proof
assignments, namespaces, local options, errors, or a completed proof.
Elaboration is synchronous. Each request starts with `Command.mkState`, and its
resulting command state is discarded after Lean's diagnostics are serialized.

Before using a cache hit, the worker checks modification time and size for all
direct and transitive imported `.olean`, `.olean.server`, `.olean.private`, and
`.ir` paths. Absence of an optional part is recorded too. A changed artifact
fails the request and forces a new process for a later attempt. This metadata
check assumes the installed, pinned dependencies are trusted and are not being
rewritten adversarially while a solve runs; it is not a replacement for the
repository pins or the final fresh compiler checks.

The JavaScript owner also fingerprints the toolchain, Lake configuration and
manifest, worker and bridge sources, built bridge metadata, and the selected
launch variables that affect toolchain or import lookup. A change releases the
old worker before starting the next request. Environment values are included
only in the digest, never written to telemetry.

Lean's native `Message.toJson` supplies severity, exact file locations and error
text. The existing `parseLeanOutput` function is the sole owner of interpreting
those messages into formal-verification feedback. Internal variable numbers
can differ between synchronous elaboration and the CLI's asynchronous
elaboration. The contexts are equivalent up to variable renaming; types,
dependency relationships, visible names, locations and sentinel errors are
preserved.

## Bounds and failure behavior

Requests are serialized. A request's deadline includes first-start compilation
of the worker, its handshake, import work and candidate elaboration. The default
deadline is 30 seconds; the solver passes its remaining per-call budget. Source
text is capped at 4 MiB. Default output is capped at 1 MiB, and truncation makes
the observation inadmissible. The process uses one Lean worker thread and Lean's
2,048 MiB memory setting. These limits do not constitute an operating-system
sandbox.

Timeout, crash, malformed JSON or UTF-8, an incorrect request identifier,
inconsistent diagnostics and exit status, unexpected stderr, and excess output
all fail the current request. The adapter does not silently retry a failed
candidate. A subsequent request starts a new process. Linux termination targets
the owned process group while its leader is still live; a reaped PID is never
used to identify a process group. Cleanup waits up to two seconds for process
and stdio closure and reports failure if ownership cannot yet be released.

The worker consumes source already admitted by the immutable scaffold and
proposal guards. Lean, the pinned libraries, local worker commands and imported
tactics remain trusted executable code. The guard and the worker provide no
hostile-code operating-system isolation.

## Verification and measurement

The focused checks are:

```sh
node --test formal/test/lean-session.test.mjs
FVA_INTEGRATION=1 node --test formal/test/lean-session.test.mjs
```

The subprocess fixtures exercise timeouts, late handshakes, crashes, malformed
frames, inconsistent exit status, output limits, concurrent request ordering,
configuration invalidation, suspension/resumption, closing pending work, and
Linux descendant termination. The actual Lean test compares Mathlib goals and
native diagnostics with a fresh CLI process, then verifies that declarations,
failed tactics, namespaces and previously imported tactic syntax do not leak
into later requests.

`formal/scripts/measure-worker.mjs` runs an identical complete workflow in either
mode: a fixed real-algebra conjunction, a `constructor` split, failed
`assumption` and `rfl` candidates on each child, a successful `linarith` candidate
for each child, and both fresh final verification calls. It uses zero model
tokens and writes the normal proof and attempt evidence:

```sh
node formal/scripts/measure-worker.mjs process /tmp/fva-process-measurement
node formal/scripts/measure-worker.mjs worker /tmp/fva-worker-measurement
```

On Linux, the standard-library Python wrapper runs both modes sequentially and
also records waited-child CPU counters and a 20 ms sampled sum of live
process-family resident memory:

```sh
python3 formal/scripts/measure-worker-resources.py /tmp/fva-worker-comparison
```

The CPU counters are incomplete and cannot support a total-family CPU comparison:
terminating Lake and Lean together can prevent Lake from reaping the Lean child,
whose CPU time then does not reach the outer `wait4` counter. The wrapper emits
`cpuMeasurementComplete: false` and `cpuComparableAcrossModes: false` explicitly.
The memory number is a sampled high-water estimate and counts shared resident
pages once per process; it is not an exact physical-memory peak.

Use new output directories for each run. A warmed operating-system file cache
does not mean the persistent Lean worker is warm: its first request still
starts a process and loads the imported environment. Cold worker startup can be
more expensive than one fresh compiler call, so repeated-candidate latency must
be considered together with complete-task time. Resident worker imports also
compete with final compiler processes for resources; this is why the engine
suspends exploration before final validation.

### Recorded experiment, 20 November 2026

Both measured pairs completed the same 12-call, seven-step, depth-one search
with zero model tokens and byte-identical final proofs. Each run passed both
fresh final checks. The complete records and limitations are in
[the performance report](../performance/worker-2026-11-20/README.md).

| Complete workflow | Fresh process backend | Persistent exploration |
| --- | ---: | ---: |
| Initial pair, elapsed | 30.709 s | 28.658 s |
| Corrected memory-sampler pair, elapsed | 39.435 s | 25.831 s |
| Corrected pair, sampled family RSS | 2.18 GiB | 3.19 GiB |
| Total process-family CPU | Not established by this instrument | Not established by this instrument |

Observed elapsed-time reductions were 6.7% and 34.5%; these are two measurements
of one fixed workflow, not a guaranteed speedup. Cold worker calls took about
16.4 seconds, whereas its nine subsequent cached observations had medians of
153 and 176 milliseconds. The worker's sampled resident memory was about 46%
higher in the corrected measurement. That startup and memory cost can outweigh
the benefit for short searches. Total worker-family CPU remains unmeasured.
