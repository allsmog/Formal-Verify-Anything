# V2 disjoint holdout and provider comparison

The v2 suite is a frozen set of 24 miniF2F statements. It is separate from the v1
suite, and the v2 harness never writes v1 manifests, traces, proofs, or reports.

## Frozen selection

The source is
[yangky11/miniF2F-lean4 at 5746b7d6c47855ce1294bed87329618ff7f1bc31](https://github.com/yangky11/miniF2F-lean4/tree/5746b7d6c47855ce1294bed87329618ff7f1bc31).
Selection was recorded at **2026-11-20 06:58:07.774924 UTC**, before v2 solver runs.
The immutable [`holdout.json`](holdout.json) has SHA-256:

```text
c5180a561a72b0d069ef1bebc80b4163aa472ac076bc4d6128c9555682e821b3
```

[`selection.json`](selection.json) records the complete eligible filename
inventories, rankings, exclusions, seed, and selected paths. All twelve v1
miniF2F identifiers are excluded. Within each of `mathd_algebra_`,
`mathd_numbertheory_`, and `induction_`, select eight files from `MiniF2F/Test`
using ascending SHA-256 of the UTF-8 string:

```text
Formal-Verify-Anything-v2-stratified-holdout-v1
<source path>
```

The seed and path are separated by exactly one newline. The source path breaks
any hash tie. There are 58 eligible algebra files, 60 number-theory files, and
exactly eight induction files after exclusions. Consequently every Test induction
file is included. **No Valid examples are used.**

Original declaration bytes, source-file hashes, statement hashes, source URLs,
imports, and namespace openings are retained. Upstream proof bodies are discarded
after transient source extraction and are never imported or supplied to either
provider. The original Apache-2.0 and Lean 4 repository MIT license texts remain
in [`../licenses/`](../licenses/); the upstream licensing discrepancy is described
in the [v1 attribution](../README.md#attribution-and-licenses).

## Execution environment

[`execution-profiles.json`](execution-profiles.json) is separate from the frozen
original statements. Both providers receive the exact same fixed profile for a
given theorem. The original namespace openings are preserved verbatim, including
`BigOperators`, `Real`, `Nat`, `Topology`, and `Rat` where originally present.

Common imports provide numeric normalization, linear/nonlinear arithmetic, ring
normalization, field simplification, positivity, and generalized congruence.
Core Lean provides `omega`, `simp_all`, `norm_cast`, and `exact_mod_cast` through
the trusted bridge. Aesop is available through mathlib's common tactic imports.
Additional modules are chosen from the original declaration's use of square
roots, gcd, primality, factorials, parity, or finite sums/products. No import is
selected in response to a solver result.

This is an import-restricted execution environment. It does not reproduce the
upstream blanket `import Mathlib`, and may omit lemmas a full-mathlib system could
use. The original source's unlimited-heartbeat setting is replaced by the fixed
experiment budget. The theorem declarations themselves are not changed.

## Validate the source selection

```sh
git clone https://github.com/yangky11/miniF2F-lean4 /path/to/miniF2F-lean4
node benchmarks/v2/verify-source.mjs --source /path/to/miniF2F-lean4
```

The verifier checks the full eligible corpus against the pinned commit, recomputes
selection and declaration hashes, verifies original imports/openings, and checks
the preserved license bytes. It performs no solver or model call.

## Run the comparison

The Lean project must be built, and the Codex CLI must
already be authenticated. The worker mode uses a persistent Lean exploration
session per invocation; final proof validation always uses fresh processes.

```sh
node benchmarks/v2/run.mjs --provider both --compiler worker
```

The two methods are the implemented `deterministic-v2` proposal policy and the
actual Codex CLI proposer. No model name is silently overridden: the configured
Codex model is used unless `--model NAME` is explicitly supplied. Resolved model
identity is recorded when the provider reports it.

Before any holdout model invocation, the harness calls the actual proposer once
on a non-holdout `True` goal. This checks runtime availability without consuming a
benchmark attempt. If startup or authentication is unavailable, the harness saves
the exact structured error as `provider-preflight.json`, blocks the provider once,
and submits **no holdout theorem** to it. The deterministic suite can still run to
completion. The report then says that the model comparison is unavailable; it does
not turn 24 unattempted items into 24 model theorem failures. Any preflight token
usage is separate from the per-theorem totals. A blocked-provider run exits with
code 2 after writing its measured results and blocker evidence.

The shared limits are 64 compiler calls, 64 proposal steps, three proposal rounds
per node, depth eight, 30 seconds per compiler call, 300 seconds per theorem, and
200,000 Lean heartbeats. The model-token admission allowance is **50,000 per theorem** by
default; `--max-model-tokens N` changes that allowance before the run begins and
records the chosen value. The deterministic policy has a zero-token allowance.
This is not a provider billing cap: an already-running request can exceed the
remaining allowance. Its actual usage is still charged and its proposals are rejected.
Actual usage comes from provider responses. Incomplete usage is not invented or
silently treated as zero.

Method order alternates by the original frozen theorem index. Each provider gets
its own search state, output directory, and managed compiler session. Neither
receives the other's proofs or traces. `protocol.json` records the complete
planned order, resource limits, input hashes, and runtime source/artifact hashes
before the first invocation. Progress is checkpointed after each invocation.
The harness retries failed cleanup while it still holds the worker and provider
owners. If cleanup remains unresolved, it stops scheduling, records an incomplete
run, and retains retry capabilities on its returned object. Such a run cannot
replace the full-holdout report.

The full-holdout request produces `results.md` and `results.json` here, plus complete traces
in a timestamped `runs/` directory. All 24 selected items remain in each available
provider's denominator. An unavailable provider has no holdout score. The report distinguishes pass@1 for a complete bounded invocation
from the individual proposals inside it, and records final failure categories,
compiler calls, depth, actual token usage, and per-theorem evidence links.

Diagnostic commands write separate reports and cannot replace the full paired
comparison:

```sh
node benchmarks/v2/run.mjs --provider deterministic --compiler process --only mathd_algebra_176
node benchmarks/v2/run.mjs --provider codex --compiler worker --only mathd_algebra_176
```

Do not use holdout outcomes to change the policy and silently rerun the same
comparison. Retain the original run and label any subsequent experiment as a new
policy/version. A partial run is not a completed comparison.

## Recheck the completed results

```sh
node --test benchmarks/v2/integrity.test.mjs
node benchmarks/v2/verify-results.mjs
```

The verifier requires the completed `results.json`; a missing or partial report
is an error rather than a skipped check. It requires every deterministic problem
exactly once, and either all 24 Codex attempts or an explicit blocked preflight
with zero Codex theorem attempts. It checks the frozen selection and import
hashes, per-theorem records, compiler receipts and source hashes, proposal usage,
pruned-branch restoration, and both original fresh final checks. Repeated proof
tree node IDs are interpreted through their visit indices.

By default it then independently compiles every recorded `SOLVED` proof in a new
Lean process and reapplies the exact manifest scaffold and kernel audit. Failed
items are not retried or rescored. Receipts are written to timestamped files in
`rechecks/`; the original run is left intact. `--structural-only` performs the
accounting and artifact checks without new Lean calls and labels its receipt
accordingly. `--report PATH` selects another retained full report, and
`--output PATH` chooses a new receipt file. Current execution-byte differences,
including rebuilt compiler artifacts, are disclosed in the receipt; they are not
presented as evidence that the original and recheck environments were identical.

## Interpretation

“Holdout” means disjoint from this project's v1 evaluation and selected before
v2 evaluation. These are public problems, so that does not establish that the
Codex model has never seen them in training. This is one bounded invocation per
provider and problem, not a repeated-sampling estimate or a full miniF2F score.

The v2 validation policy and the disjoint statement selection also prevent
treating its success rate as a controlled numerical improvement over v1. The
within-v2 comparison holds the theorem set, imports, compiler mode, and search
resource ceilings fixed. Provider latency and token consumption are recorded,
while CPU time, peak memory, cache warmth, dollar cost, and provider-side resource
allocation are not measured.
