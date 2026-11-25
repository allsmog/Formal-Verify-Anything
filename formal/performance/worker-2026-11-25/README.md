# Persistent worker: completed-workflow measurement

One measured pair completed the same recursive proof search on Lean 4.24.0 with
the pinned Mathlib revision, first with a fresh Lean process per exploration
call (`process`) and then with the persistent exploration worker (`worker`).
The worker finished in less elapsed time and used more sampled resident memory.
**Total worker-family CPU was not measured reliably; the waited-child counters
do not support a CPU-savings claim.**

This is a transport microbenchmark on one constructed theorem with a scripted
proposer and zero model tokens. It does not measure an LLM's theorem-proving
accuracy or establish a speedup on other tasks.

## Identical completed work

```lean
theorem worker_measurement (a b : ℝ)
    (ha : 2 * a + 3 = 7) (hb : 3 * b - 1 = 8) : a = 2 ∧ b = 3 := by
  constructor
  · linarith
  · linarith
```

Both runs returned `SOLVED` with 12 compiler calls and seven tactic steps: ten
exploration calls and two fresh CLI calls that compiled and audited the
standalone file. The worker was suspended before the fresh final calls and
closed by the engine afterward (`exploration.cleanup.status = closed`). Both
final files have SHA-256
`9da8d38ffcc4078f4211f470d023b3de213451148a07a5c3ab38e8848eba137c`.

## Results

| Mode | Wall time | Sampled peak family RSS | Samples | Max live processes |
| --- | ---: | ---: | ---: | ---: |
| process | 41.8 s | 1.90 GB | 831 | 3 |
| worker | 17.0 s | 2.59 GB | 342 | 3 |

Host: Apple M4, 16 GB memory, macOS 26.6, arm64. The runs were sequential,
`process` first. The OS file cache was not controlled; earlier setup and test
runs had already read the Mathlib artifacts. Memory is a 20 ms sampled sum of
resident sets across the live process family (`ps` on macOS), so shared pages
may be counted more than once. It is a high-water estimate, not an exact
physical peak.

Exact numbers, CPU counters marked incomplete, and source hashes are in
[measurement.json](measurement.json). Each mode's complete solver artifacts are
in [process/](process/) and [worker/](worker/).

## Reproduction

With the toolchain and Lean build in place, from the repository root:

```sh
python3 formal/scripts/measure-worker-resources.py formal/performance/NEW_DIRECTORY
```

The wrapper hashes the engine, compiler, guards, bridge, worker, measurement
scripts, and pinned environment inputs, and rejects the pair if any of them
change while it runs.
