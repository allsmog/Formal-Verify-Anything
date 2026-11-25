# Formal Verify Anything v2 — provider comparison

Run: `2026-11-25T17-54-58-148Z-paired-24-b529a43c`. Started 2026-11-25T17:54:58.148Z; finished 2026-11-25T18:23:19.293Z.

Scope: **complete paired 24-problem holdout comparison**.

## Protocol

Each provider receives one bounded search invocation per selected theorem. pass@1 means success of that complete invocation, including its internal proposals, recursive subgoals, and backtracking. It is not a first-tactic score or an estimate over repeated model samples. The deterministic and model runs receive the same original theorem, fixed import environment, compiler mode, compiler-call ceiling, search-step ceiling, recursion depth, heartbeat limit, and per-theorem wall-time budget.

When selected, the model provider uses the actual Codex CLI adapter, which requires an already-authenticated CLI. Before any holdout model invocation, one real availability check uses a non-holdout True goal. An unavailable provider is blocked once; no doomed per-theorem calls are made, and its unattempted theorems are not scored as failures. Preflight usage, if reported, is recorded separately from theorem usage. After successful preflight, a theorem invocation that encounters a provider error, timeout, exhausted budget, or acceptance failure stays in the denominator. Missing token usage remains unknown.

The order alternates by the theorem’s frozen index: deterministic first on even indices and Codex first on odd indices. Each invocation has isolated search state and output. No provider receives another provider’s proof or transcript. Both use the same configured exploration compiler, while successful final proofs are validated by fresh standalone compiler processes.

| Shared resource limit | Value |
| --- | ---: |
| maxCompilerCalls | 64 |
| maxSteps | 64 |
| maxProposalRounds | 3 |
| maxDepth | 8 |
| callTimeoutMs | 30000 |
| theoremTimeoutMs | 300000 |
| heartbeats | 200000 |

Exploration compiler: `worker`. Model-token admission allowance per Codex invocation: **50000**; deterministic allowance: **0**. This is not a provider billing cap: an already-running request can exceed the remaining allowance; its actual usage is still charged and its proposals are rejected.
Requested model: the configured Codex default; resolved identity is recorded where reported by the provider.

The original statement strings and namespace openings are preserved. Fixed declaration-based Mathlib imports replace the upstream blanket import. This is an import-restricted configuration, not a claim of identical execution conditions to the full upstream benchmark. The selection was frozen before v2 evaluation, is disjoint from all twelve v1 miniF2F IDs, and contains eight Test algebra, eight Test number-theory, and all eight Test induction problems.

## Results

Codex availability: **AVAILABLE**. [Actual preflight evidence](provider-preflight.json).

| Provider | SOLVED / attempted (pass@1) | Compiler calls | Mean calls per solved theorem | Maximum explored depth | Model tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| deterministic-v2 | 11/24 (45.8%) | 979 | 15.73 | 8 | 0 |
| codex | 17/24 (70.8%) | 97 | 4.41 | 1 | unknown (known subtotal 471764) |

| Stratum | Provider | SOLVED / attempted |
| --- | --- | ---: |
| algebra | deterministic-v2 | 3/8 (37.5%) |
| algebra | codex | 6/8 (75.0%) |
| number_theory | deterministic-v2 | 6/8 (75.0%) |
| number_theory | codex | 8/8 (100.0%) |
| induction | deterministic-v2 | 2/8 (25.0%) |
| induction | codex | 3/8 (37.5%) |

Paired outcomes: both **11**, deterministic only **0**, Codex only **6**, neither **7**, incomplete pairs **0**.

## Per-theorem evidence

| Theorem | Stratum | Provider | Status | Calls | Steps | Depth | Tokens | Evidence |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| mathd_algebra_293 | algebra | deterministic-v2 | FAILED | 62 | 53 | 5 | 0 | [compiler_budget](deterministic-v2/mathd_algebra_293/result.json) |
| mathd_algebra_293 | algebra | codex | SOLVED | 4 | 1 | 0 | 18155 | [proof](codex/mathd_algebra_293/mathd_algebra_293.lean) · [trace](codex/mathd_algebra_293/result.json) |
| mathd_algebra_320 | algebra | codex | FAILED | 1 | 0 | 0 | unknown | [provider_timeout](codex/mathd_algebra_320/result.json) |
| mathd_algebra_320 | algebra | deterministic-v2 | FAILED | 62 | 54 | 7 | 0 | [compiler_budget](deterministic-v2/mathd_algebra_320/result.json) |
| mathd_algebra_332 | algebra | deterministic-v2 | FAILED | 62 | 56 | 3 | 0 | [compiler_budget](deterministic-v2/mathd_algebra_332/result.json) |
| mathd_algebra_332 | algebra | codex | FAILED | 8 | 4 | 1 | 53298 | [model_token_budget](codex/mathd_algebra_332/result.json) |
| mathd_algebra_176 | algebra | codex | SOLVED | 4 | 1 | 0 | 16750 | [proof](codex/mathd_algebra_176/mathd_algebra_176.lean) · [trace](codex/mathd_algebra_176/result.json) |
| mathd_algebra_176 | algebra | deterministic-v2 | SOLVED | 9 | 6 | 0 | 0 | [proof](deterministic-v2/mathd_algebra_176/mathd_algebra_176.lean) · [trace](deterministic-v2/mathd_algebra_176/result.json) |
| mathd_algebra_362 | algebra | deterministic-v2 | FAILED | 62 | 52 | 6 | 0 | [compiler_budget](deterministic-v2/mathd_algebra_362/result.json) |
| mathd_algebra_362 | algebra | codex | SOLVED | 6 | 2 | 0 | 19156 | [proof](codex/mathd_algebra_362/mathd_algebra_362.lean) · [trace](codex/mathd_algebra_362/result.json) |
| mathd_algebra_440 | algebra | codex | SOLVED | 4 | 1 | 0 | 17092 | [proof](codex/mathd_algebra_440/mathd_algebra_440.lean) · [trace](codex/mathd_algebra_440/result.json) |
| mathd_algebra_440 | algebra | deterministic-v2 | SOLVED | 21 | 15 | 3 | 0 | [proof](deterministic-v2/mathd_algebra_440/mathd_algebra_440.lean) · [trace](deterministic-v2/mathd_algebra_440/result.json) |
| mathd_algebra_432 | algebra | deterministic-v2 | SOLVED | 9 | 6 | 0 | 0 | [proof](deterministic-v2/mathd_algebra_432/mathd_algebra_432.lean) · [trace](deterministic-v2/mathd_algebra_432/result.json) |
| mathd_algebra_432 | algebra | codex | SOLVED | 4 | 1 | 0 | 16615 | [proof](codex/mathd_algebra_432/mathd_algebra_432.lean) · [trace](codex/mathd_algebra_432/result.json) |
| mathd_algebra_288 | algebra | codex | SOLVED | 6 | 2 | 0 | 18721 | [proof](codex/mathd_algebra_288/mathd_algebra_288.lean) · [trace](codex/mathd_algebra_288/result.json) |
| mathd_algebra_288 | algebra | deterministic-v2 | FAILED | 62 | 57 | 4 | 0 | [compiler_budget](deterministic-v2/mathd_algebra_288/result.json) |
| mathd_numbertheory_435 | number_theory | deterministic-v2 | FAILED | 62 | 56 | 5 | 0 | [compiler_budget](deterministic-v2/mathd_numbertheory_435/result.json) |
| mathd_numbertheory_435 | number_theory | codex | SOLVED | 4 | 1 | 0 | 18775 | [proof](codex/mathd_numbertheory_435/mathd_numbertheory_435.lean) · [trace](codex/mathd_numbertheory_435/result.json) |
| mathd_numbertheory_293 | number_theory | codex | SOLVED | 5 | 2 | 0 | 19225 | [proof](codex/mathd_numbertheory_293/mathd_numbertheory_293.lean) · [trace](codex/mathd_numbertheory_293/result.json) |
| mathd_numbertheory_293 | number_theory | deterministic-v2 | SOLVED | 11 | 7 | 1 | 0 | [proof](deterministic-v2/mathd_numbertheory_293/mathd_numbertheory_293.lean) · [trace](deterministic-v2/mathd_numbertheory_293/result.json) |
| mathd_numbertheory_447 | number_theory | deterministic-v2 | SOLVED | 5 | 2 | 0 | 0 | [proof](deterministic-v2/mathd_numbertheory_447/mathd_numbertheory_447.lean) · [trace](deterministic-v2/mathd_numbertheory_447/result.json) |
| mathd_numbertheory_447 | number_theory | codex | SOLVED | 4 | 1 | 0 | 18460 | [proof](codex/mathd_numbertheory_447/mathd_numbertheory_447.lean) · [trace](codex/mathd_numbertheory_447/result.json) |
| mathd_numbertheory_247 | number_theory | codex | SOLVED | 6 | 2 | 0 | 19053 | [proof](codex/mathd_numbertheory_247/mathd_numbertheory_247.lean) · [trace](codex/mathd_numbertheory_247/result.json) |
| mathd_numbertheory_247 | number_theory | deterministic-v2 | SOLVED | 7 | 4 | 0 | 0 | [proof](deterministic-v2/mathd_numbertheory_247/mathd_numbertheory_247.lean) · [trace](deterministic-v2/mathd_numbertheory_247/result.json) |
| mathd_numbertheory_582 | number_theory | deterministic-v2 | SOLVED | 7 | 4 | 0 | 0 | [proof](deterministic-v2/mathd_numbertheory_582/mathd_numbertheory_582.lean) · [trace](deterministic-v2/mathd_numbertheory_582/result.json) |
| mathd_numbertheory_582 | number_theory | codex | SOLVED | 4 | 1 | 0 | 17557 | [proof](codex/mathd_numbertheory_582/mathd_numbertheory_582.lean) · [trace](codex/mathd_numbertheory_582/result.json) |
| mathd_numbertheory_229 | number_theory | codex | SOLVED | 4 | 1 | 0 | 16744 | [proof](codex/mathd_numbertheory_229/mathd_numbertheory_229.lean) · [trace](codex/mathd_numbertheory_229/result.json) |
| mathd_numbertheory_229 | number_theory | deterministic-v2 | SOLVED | 5 | 2 | 0 | 0 | [proof](deterministic-v2/mathd_numbertheory_229/mathd_numbertheory_229.lean) · [trace](deterministic-v2/mathd_numbertheory_229/result.json) |
| mathd_numbertheory_212 | number_theory | deterministic-v2 | SOLVED | 5 | 2 | 0 | 0 | [proof](deterministic-v2/mathd_numbertheory_212/mathd_numbertheory_212.lean) · [trace](deterministic-v2/mathd_numbertheory_212/result.json) |
| mathd_numbertheory_212 | number_theory | codex | SOLVED | 4 | 1 | 0 | 16969 | [proof](codex/mathd_numbertheory_212/mathd_numbertheory_212.lean) · [trace](codex/mathd_numbertheory_212/result.json) |
| mathd_numbertheory_521 | number_theory | codex | SOLVED | 4 | 1 | 0 | 19054 | [proof](codex/mathd_numbertheory_521/mathd_numbertheory_521.lean) · [trace](codex/mathd_numbertheory_521/result.json) |
| mathd_numbertheory_521 | number_theory | deterministic-v2 | FAILED | 62 | 55 | 4 | 0 | [compiler_budget](deterministic-v2/mathd_numbertheory_521/result.json) |
| induction_pprime_pdvdapowpma | induction | deterministic-v2 | FAILED | 62 | 55 | 4 | 0 | [compiler_budget](deterministic-v2/induction_pprime_pdvdapowpma/result.json) |
| induction_pprime_pdvdapowpma | induction | codex | FAILED | 1 | 0 | 0 | unknown | [provider_timeout](codex/induction_pprime_pdvdapowpma/result.json) |
| induction_1pxpownlt1pnx | induction | codex | SOLVED | 4 | 1 | 0 | 18212 | [proof](codex/induction_1pxpownlt1pnx/induction_1pxpownlt1pnx.lean) · [trace](codex/induction_1pxpownlt1pnx/result.json) |
| induction_1pxpownlt1pnx | induction | deterministic-v2 | FAILED | 62 | 52 | 7 | 0 | [compiler_budget](deterministic-v2/induction_1pxpownlt1pnx/result.json) |
| induction_sumkexp3eqsumksq | induction | deterministic-v2 | FAILED | 62 | 56 | 3 | 0 | [compiler_budget](deterministic-v2/induction_sumkexp3eqsumksq/result.json) |
| induction_sumkexp3eqsumksq | induction | codex | FAILED | 4 | 2 | 1 | 54477 | [model_token_budget](codex/induction_sumkexp3eqsumksq/result.json) |
| induction_nfactltnexpnm1ngt3 | induction | codex | FAILED | 6 | 3 | 1 | 57725 | [model_token_budget](codex/induction_nfactltnexpnm1ngt3/result.json) |
| induction_nfactltnexpnm1ngt3 | induction | deterministic-v2 | FAILED | 62 | 56 | 3 | 0 | [compiler_budget](deterministic-v2/induction_nfactltnexpnm1ngt3/result.json) |
| induction_prod1p1onk3le3m1onn | induction | deterministic-v2 | FAILED | 62 | 49 | 8 | 0 | [compiler_budget](deterministic-v2/induction_prod1p1onk3le3m1onn/result.json) |
| induction_prod1p1onk3le3m1onn | induction | codex | FAILED | 1 | 0 | 0 | unknown | [provider_timeout](codex/induction_prod1p1onk3le3m1onn/result.json) |
| induction_12dvd4expnp1p20 | induction | codex | SOLVED | 4 | 1 | 0 | 18112 | [proof](codex/induction_12dvd4expnp1p20/induction_12dvd4expnp1p20.lean) · [trace](codex/induction_12dvd4expnp1p20/result.json) |
| induction_12dvd4expnp1p20 | induction | deterministic-v2 | SOLVED | 36 | 29 | 3 | 0 | [proof](deterministic-v2/induction_12dvd4expnp1p20/induction_12dvd4expnp1p20.lean) · [trace](deterministic-v2/induction_12dvd4expnp1p20/result.json) |
| induction_pord1p1on2powklt5on2 | induction | deterministic-v2 | FAILED | 62 | 47 | 8 | 0 | [compiler_budget](deterministic-v2/induction_pord1p1on2powklt5on2/result.json) |
| induction_pord1p1on2powklt5on2 | induction | codex | FAILED | 1 | 0 | 0 | unknown | [provider_timeout](codex/induction_pord1p1on2powklt5on2/result.json) |
| induction_11div10tonmn1ton | induction | codex | SOLVED | 4 | 1 | 0 | 17614 | [proof](codex/induction_11div10tonmn1ton/induction_11div10tonmn1ton.lean) · [trace](codex/induction_11div10tonmn1ton/result.json) |
| induction_11div10tonmn1ton | induction | deterministic-v2 | SOLVED | 58 | 45 | 5 | 0 | [proof](deterministic-v2/induction_11div10tonmn1ton/induction_11div10tonmn1ton.lean) · [trace](deterministic-v2/induction_11div10tonmn1ton/result.json) |

## Failure and provider telemetry

| Provider | Final category | Invocations |
| --- | --- | ---: |
| codex | model_token_budget | 3 |
| codex | provider_timeout | 4 |
| deterministic-v2 | compiler_budget | 13 |

The per-invocation details preserve compiler attempts, branch restoration records, proposer rounds, actual provider metadata/usage/error records, and final candidate audits. Diagnostic severity matters: a warning or informational audit message is not a mathematical compiler error merely because a broad category string says `compiler_error`.

## Provenance and limits

Selection frozen at **2026-11-20T06:58:07.774924Z**. Upstream miniF2F commit: `5746b7d6c47855ce1294bed87329618ff7f1bc31`.
Local source commit at run start: `e57b80543661f96ae8a1660f693cc2e8e6798a3e`; working tree dirty: `false`.
Node `v26.3.0`; Lean toolchain `leanprover/lean4:v4.24.0`.
Execution/input byte checks at completion: **unchanged**.

| Frozen input | SHA-256 |
| --- | --- |
| benchmarks/v2/holdout.json | `c5180a561a72b0d069ef1bebc80b4163aa472ac076bc4d6128c9555682e821b3` |
| benchmarks/v2/selection.json | `65f24bc8fb7f18132b8a3afdee3a6c76ef3bf782e58d23d56ee7986b36ecff1c` |
| benchmarks/v2/execution-profiles.json | `5265e241c25e5d1653c558148653058824c93265f8d52d800428481936a2cab1` |

The run JSON also captures source and runtime artifact hashes. These identify observed bytes; they are not a signed attestation or proof of source-to-binary equivalence. v1 results remain unchanged and are not pooled with this disjoint holdout. Different problems and the v2 validation policy prevent interpreting a v1-to-v2 percentage difference as a controlled improvement measurement.

This is a small public holdout. “Holdout” means withheld from this project’s v1 run and selected before v2 evaluation; it does not establish absence from any model’s training data. No repeated-sampling confidence claim is made. Wall time is recorded, but CPU time, peak memory, cache warmth, provider-side resource allocation, and dollar cost are not measured. Standard library lemmas are available through the fixed imports; benchmark theorem modules and their proof bodies are never imported.

## Reproduce

```sh
node benchmarks/v2/verify-source.mjs --source /path/to/miniF2F-lean4
node benchmarks/v2/run.mjs --provider both --compiler worker
node benchmarks/v2/verify-results.mjs
```

The Codex CLI must already be authenticated and able to initialize its runtime. The adapter uses its configured model unless an explicit `--model` is supplied. If preflight is blocked, the command records the blocker, runs any available deterministic jobs, and exits with code 2. `--only ID` and single-provider runs write diagnostic reports in their own directories and cannot replace the full-holdout report.
