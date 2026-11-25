# Proof benchmark protocol

This page describes the immutable v1 experiment. Current evaluation is documented
in [v2/README.md](v2/README.md). New invocations of `benchmarks/run.mjs`, including
the full 17-problem suite, write diagnostic reports and cannot replace the
published `benchmarks/results.md` or `results.json`.

This suite measures one bounded invocation of the formal proof search engine on
each of 17 statements. Only a standalone Lean file accepted by the engine's
compiler, statement-integrity, prohibited-token, and kernel-dependency checks can
be marked `SOLVED`.

## Datasets

### Import configuration

The complete `Mathlib` import exceeded a 60-second import-only preflight in this
environment. Before the canonical run, imports were restricted to fixed
declaration-required modules plus `Mathlib.Tactic.NormNum`,
`Mathlib.Tactic.Linarith.Frontend`, and `Mathlib.Tactic.Ring`.
Ordinary algebra uses `Mathlib.Data.Real.Basic`;
the real-power statement uses `Mathlib.Analysis.SpecialFunctions.Pow.Real`, the
floor statement uses `Mathlib.Data.Real.Archimedean`, and Tier 1 uses
`Mathlib.Data.List.Basic`. All original theorem declaration bytes and hashes are
unchanged. The original blanket import and unused namespace openings are recorded
under `provenance.originalImports` and `provenance.originalOpens`.

Import-only checks for the restricted configurations compiled successfully. The
30-second per-compiler timeout and 300-second per-theorem budget were fixed after
that setup check and before the canonical run. The earlier failed setup run is
retained as a diagnostic, separate from the canonical benchmark results. No
miniF2F problem was evaluated to choose the import policy or search budget.

`tier1.json` contains five constructed sanity checks: natural-number addition
commutativity, generic list reversal involution, De Morgan's not-or equivalence,
conjunction commutation from an explicit conjunction hypothesis, and implication
composition. They exercise basic term construction and recursive proof search.

`minif2f.json` contains exactly the first 12 files, sorted lexicographically, that
match `MiniF2F/Test/mathd_algebra_*.lean` in
[yangky11/miniF2F-lean4 at 5746b7d6c47855ce1294bed87329618ff7f1bc31](https://github.com/yangky11/miniF2F-lean4/tree/5746b7d6c47855ce1294bed87329618ff7f1bc31).
Selection was fixed before any solver run. The IDs are `107`, `113`, `114`, `125`,
`129`, `137`, `139`, `141`, `142`, `143`, `148`, and `153`, each prefixed with
`mathd_algebra_`.

The complete original theorem declarations, including whitespace before the
proof assignment, are preserved. Each entry records the original source-file
SHA-256, declaration SHA-256, commit, and immutable source URL. Proof bodies are
discarded during extraction and never imported into the solver. The compiler
imports `Mathlib`, not `MiniF2F` or any benchmark theorem module.

The source pins Lean `v4.24.0` and mathlib commit
`f897ebcf72cd16f89ab4577d0c826cd14afaafc7`. Its unlimited `maxHeartbeats` setting
is deliberately replaced by the experiment's explicit resource budget. The
original theorem type signatures are not altered.

## Execute

```sh
node scripts/fetch-minif2f.mjs --check
lake exe cache get
lake build
node benchmarks/run.mjs --tier all
```

`fetch-minif2f.mjs` downloads source bytes from the pinned commit, checks the
locked hashes, extracts the declarations, and validates both license texts. It
keeps upstream proof bodies only transiently in memory and never writes them
into the runtime. Omit `--check` to restore exact pinned declarations. For offline
verification against an existing source checkout, add `--source /path/to/miniF2F-lean4`;
license bytes are then checked against the pinned local hashes.

Each new run writes `results.md` and `results.json` inside a timestamped directory
in `runs/`. Each theorem directory contains engine artifacts and a `result.json`
with its proof tree, attempts, diagnostics, status, and metrics. A running
experiment checkpoints `progress.json` after every theorem. The original
canonical report is retained unchanged, including its original warning policy.

```sh
node benchmarks/run.mjs --tier 1
node benchmarks/run.mjs --only mathd_algebra_142
```

These diagnostic subsets always write separate reports under `runs/`; they
cannot overwrite the full-suite report or silently remove failures from its
denominator.

## Budget and measurement

Every theorem uses the same limits: 64 compiler calls, maximum recursion depth 8,
30 seconds per compiler call, 300 seconds per theorem, 200,000 Lean heartbeats,
and zero model tokens. Additional engine defaults are recorded in the report.

`pass@1` is the fraction solved by one complete bounded search invocation. An
invocation can test multiple tactics and recurse into several subgoals. The
first candidate's success is reported separately. Compiler calls, search steps,
maximum depth, elapsed wall time, model tokens, and final failure modes are
recorded for every theorem. Missing telemetry remains unknown; failures remain
in the denominator. A timeout or exhausted search does not establish falsity.

This is a small fixed algebra subset, not a claim about the complete miniF2F
benchmark or about arbitrary software verification. The deterministic baseline
does not measure LLM performance. CPU time, peak process-family memory, and cache
warmth effects are not measured.

## Recorded baseline and later integrity checks

The first complete canonical run accepted 5/5 Tier 1 and 7/12 Tier 2 problems:
12/17 overall, with 377 compiler calls and no model tokens. The generated
[results report](results.md) includes every theorem and a post-run review of
the five failures. In particular, `_125` was rejected for an unused-hypothesis
warning after a successful Lean compile; it is not a type-checking failure.

After this fixed run, hash-alias admission and canonical-report completeness
checks were tightened without changing the search policy or dataset. All twelve
accepted files were independently recompiled under the stricter checks. The
original source snapshot, later validation changes, and additional compile
transcript are retained in that run directory. Additional validation calls do
not change the original search metrics.

`node formal/scripts/recheck.mjs` requires the canonical report and exactly all
seventeen manifest IDs, then validates and compiles every recorded successful
proof. Missing reports fail instead of silently skipping the integrity gate.

## Attribution and licenses

miniF2F was originally authored by OpenAI contributors, including Kunhao Zheng,
Stanislas Polu, David Renshaw, Kudzo Ahegbebu, and OpenAI GPT-f. The Lean 4 port
was edited by Kaiyu Yang and subsequent contributors. See the original repository
and individual source files for attribution history.

The Lean source's original Apache-2.0 notice and the Lean 4 repository's MIT
license differ. [Upstream issue #27](https://github.com/yangky11/miniF2F-lean4/issues/27)
records that discrepancy. Both license texts are preserved here:

- `licenses/MiniF2F-Apache-2.0.txt`, from
  [openai/miniF2F at 4e433ff5cadff23f9911a2bb5bbab2d351ce5554](https://github.com/openai/miniF2F/blob/4e433ff5cadff23f9911a2bb5bbab2d351ce5554/lean/LICENSE).
- `licenses/MiniF2F-MIT.txt`, from the pinned Lean 4 source commit.

The manifest records immutable download URLs and SHA-256 digests for both texts.
