# Formal Verify Anything — benchmark results

Run: `2026-11-25T17-28-02-563Z-canonical`  
Started: 2026-11-25T17:28:02.563Z; finished: 2026-11-25T17:50:36.737Z.  
Scope: **canonical complete 17-problem suite**.

## Evaluation protocol

One deterministic, bounded search invocation is made per theorem. **pass@1 means success of that single complete search invocation**, including its internal candidate attempts, recursive subgoals, and backtracking. It does not mean that the first tactic worked. There is no model sampling in this baseline and the model-token budget is zero.

The original theorem declaration text and its SHA-256 are preserved. The execution environment uses fixed, declaration-required Mathlib modules plus the same generic tactic imports. Unused broad namespace openings are omitted; original imports and openings are recorded in each problem’s provenance. Full Mathlib import timed out before search during environment preflight; the diagnostic run remains under benchmarks/runs/. This is an import-restricted benchmark configuration, not the upstream blanket-import environment.

A theorem counts as SOLVED only when the engine accepts its standalone proof file after Lean compilation with exit code 0, unchanged theorem-statement validation, prohibited-token checks, and kernel dependency checks. Every selected theorem remains in the denominator, including timeouts, budget exhaustion, and harness errors. The report also checks that a reported solved artifact exists, has the locked statement hash, and contains no prohibited proof tokens.

| Budget | Value |
| --- | ---: |
| maxCompilerCalls | 64 |
| maxSteps | 64 |
| maxProposalRounds | 3 |
| maxDepth | 8 |
| callTimeoutMs | 30000 |
| theoremTimeoutMs | 300000 |
| heartbeats | 200000 |
| maxModelTokens | 0 |

Lean toolchain: `leanprover/lean4:v4.24.0`.
Source commit at run start: `beacb4a83b286bed58c0b14ae8a49073a62c2d84`; working tree dirty: `false`.
Node: `v26.3.0`; platform: `darwin/arm64`.

## Results

| Suite | Solved / attempted (pass@1) | Mean compiler calls per solved theorem | Compiler calls, all attempts | Maximum recursion depth |
| --- | ---: | ---: | ---: | ---: |
| Tier 1 — foundational | 5/5 (100.0%) | 11.00 | 55 | 3 |
| Tier 2 — miniF2F Test algebra subset | 8/12 (66.7%) | 13.88 | 359 | 8 |
| All selected problems | 13/17 (76.5%) | 12.77 | 414 | 8 |

First-candidate success (separate from pass@1): **0/17 (0.0%)**; measured for 17/17 problems.
Total recorded model tokens: **0**.

| Theorem | Tier | Status | Compiler calls | Search steps | Depth | Seconds | Termination / proof |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| [nat_add_comm](runs/2026-11-25T17-28-02-563Z-canonical/nat_add_comm/result.json) | 1 | SOLVED | 7 | 4 | 0 | 29.32 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/nat_add_comm/nat_add_comm.lean) |
| [list_reverse_involution](runs/2026-11-25T17-28-02-563Z-canonical/list_reverse_involution/result.json) | 1 | SOLVED | 6 | 3 | 0 | 14.49 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/list_reverse_involution/list_reverse_involution.lean) |
| [de_morgan_not_or](runs/2026-11-25T17-28-02-563Z-canonical/de_morgan_not_or/result.json) | 1 | SOLVED | 22 | 13 | 3 | 76.71 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/de_morgan_not_or/de_morgan_not_or.lean) |
| [conjunction_commutation](runs/2026-11-25T17-28-02-563Z-canonical/conjunction_commutation/result.json) | 1 | SOLVED | 12 | 5 | 2 | 36.74 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/conjunction_commutation/conjunction_commutation.lean) |
| [implication_composition](runs/2026-11-25T17-28-02-563Z-canonical/implication_composition/result.json) | 1 | SOLVED | 8 | 4 | 1 | 24.31 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/implication_composition/implication_composition.lean) |
| [mathd_algebra_107](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_107/result.json) | 2 | SOLVED | 23 | 18 | 2 | 69.64 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_107/mathd_algebra_107.lean) |
| [mathd_algebra_113](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_113/result.json) | 2 | FAILED | 62 | 56 | 3 | 189.04 | compiler_budget |
| [mathd_algebra_114](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_114/result.json) | 2 | FAILED | 62 | 48 | 8 | 256.00 | compiler_budget |
| [mathd_algebra_125](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_125/result.json) | 2 | SOLVED | 7 | 4 | 0 | 18.85 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_125/mathd_algebra_125.lean) |
| [mathd_algebra_129](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_129/result.json) | 2 | FAILED | 62 | 49 | 8 | 214.53 | compiler_budget |
| [mathd_algebra_137](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_137/result.json) | 2 | FAILED | 62 | 51 | 6 | 179.32 | compiler_budget |
| [mathd_algebra_139](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_139/result.json) | 2 | SOLVED | 12 | 8 | 1 | 36.46 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_139/mathd_algebra_139.lean) |
| [mathd_algebra_141](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_141/result.json) | 2 | SOLVED | 11 | 8 | 0 | 33.27 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_141/mathd_algebra_141.lean) |
| [mathd_algebra_142](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_142/result.json) | 2 | SOLVED | 14 | 10 | 1 | 41.55 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_142/mathd_algebra_142.lean) |
| [mathd_algebra_143](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_143/result.json) | 2 | SOLVED | 12 | 8 | 1 | 33.99 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_143/mathd_algebra_143.lean) |
| [mathd_algebra_148](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_148/result.json) | 2 | SOLVED | 20 | 15 | 2 | 56.33 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_148/mathd_algebra_148.lean) |
| [mathd_algebra_153](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_153/result.json) | 2 | SOLVED | 12 | 8 | 1 | 43.52 | [compiled .lean proof](runs/2026-11-25T17-28-02-563Z-canonical/mathd_algebra_153/mathd_algebra_153.lean) |

## Failure modes

| Final termination category | Theorems |
| --- | ---: |
| compiler_budget | 4 |

The detailed JSON and each theorem’s `result.json` preserve the proof tree, individual attempts, compiler diagnostics, and final failure details. A search that exhausts its configured resources does not establish that a theorem is false or unprovable.

## Dataset provenance and limits

- `benchmarks/tier1.json` — Five fixed foundational statements established before the benchmark run. SHA-256: `3f8043fd754f303bbe9df5e5711241bc930efb82d19f8e66b4863662231614fc`.
- `benchmarks/minif2f.json` — First 12 files lexicographically from MiniF2F/Test/mathd_algebra_*.lean at the pinned commit, before any solver runs. SHA-256: `3b86a7e7c0835c7fead0b02bcbfd0c519bc7c3bb32310ac19143717701edc9f4`.
  Source: [https://github.com/yangky11/miniF2F-lean4](https://github.com/yangky11/miniF2F-lean4/tree/5746b7d6c47855ce1294bed87329618ff7f1bc31), commit `5746b7d6c47855ce1294bed87329618ff7f1bc31`.

Tier 1 is a constructed sanity suite. Tier 2 preserves the original theorem declarations from the fixed miniF2F revision. Runtime imports include mathlib, but never the miniF2F theorem modules or their proof bodies. Upstream’s unlimited-heartbeat setting is not copied into the run.

This is a small, deliberately fixed algebra subset. It is not a result on all miniF2F, PutnamBench, or arbitrary software specifications. The experiment measures the implemented deterministic search policy; it does not measure an LLM’s independent theorem-proving ability. Public benchmark contamination in future model-backed experiments would require a separate assessment.

Compiler calls count the engine’s actual recorded calls, including rejected candidates and final validation as implemented by the engine. Time is end-to-end per-theorem wall time. CPU time, peak process-family memory, and cold-versus-warm cache effects are not measured. Missing telemetry is reported as unknown, not zero.

## Reproduce

```sh
node scripts/fetch-minif2f.mjs --check
lake exe cache get
lake build
node benchmarks/run.mjs --tier all
```

Diagnostic runs such as `node benchmarks/run.mjs --only mathd_algebra_142` write separate reports under `benchmarks/runs/` and cannot overwrite this canonical report. Original benchmark licenses and attribution are in `benchmarks/licenses/` and `benchmarks/README.md`.
