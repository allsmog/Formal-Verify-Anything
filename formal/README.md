# Formal proof search runtime

Formal Verify Anything runs a bounded proof search against Lean 4. **The default
policy is deterministic and makes no model calls.** It proposes structural
steps and standard tactics; Lean determines whether those steps work. The
recorded deterministic results are not measurements of LLM performance. An
explicit Codex CLI proposer is available with existing authentication; see
[the provider contract and validation status](docs/codex-proposer.md).

The runtime is plain JavaScript with no npm dependencies. It contains the proof
tree, the Lean compiler adapter, the proposal interface, input guards, and the
final proof audit. `src/support.mjs` holds the shared budget counter, the RFC 8785
canonical digest used for evidence IDs, and the bounded process-output excerpt.

## Set up

Use Node.js 22 or later, npm, Git, and an installed Lean toolchain manager such as `elan`.
Commands below run from the repository root. The project pins:

| Dependency | Version or revision |
| --- | --- |
| Lean | `leanprover/lean4:v4.24.0` |
| Mathlib | `f897ebcf72cd16f89ab4577d0c826cd14afaafc7` |

```sh
elan toolchain install leanprover/lean4:v4.24.0
lean --version
lake --version
npm ci --prefix formal
lake exe cache get
lake build FormalVerify
node formal/src/cli.mjs doctor
```

Mathlib's cache avoids
building its imported libraries from source. `doctor` checks the installed Lean
and Lake versions and the local toolchain/Mathlib pins. It performs no installs,
network requests, proof compilation, or exhaustive cache validation.

If `lean` or `lake` is missing, put the toolchain manager's binary directory on
your shell's `PATH`. Missing Lean object files normally require the cache and
Lake build steps above.

## Solve a theorem

```sh
node formal/src/cli.mjs solve benchmarks/tier1.json \
  --id conjunction_commutation \
  --out .fva/examples/conjunction
```

The output path is a new or empty **directory**. The CLI refuses to reuse a
nonempty directory so earlier evidence remains intact. Output includes a concise
JSON summary, the generated proof if solved, and the complete `result.json`.
Progress is printed to standard error. If `--out` is omitted, a unique directory
is created under `.fva/runs/`.

```sh
node formal/src/cli.mjs solve benchmarks/minif2f.json \
  --id mathd_algebra_107 \
  --out .fva/examples/algebra107
```

Without `--id`, a dataset is processed sequentially. Every theorem receives a
fresh copy of the same budget, and each has its own subdirectory. For canonical
benchmark reporting, use the dedicated harness instead of treating a diagnostic
CLI batch as the published evaluation:

```sh
node benchmarks/v2/run.mjs --provider both --compiler worker
```

The [v2 protocol](../benchmarks/v2/README.md) documents the frozen 24-problem
holdout and provider-availability checks. The [v1 benchmark](../benchmarks/README.md)
has one canonical report; other runs of its harness create diagnostic reports only.

### Input format

Acceptable input is one problem object, an array of problem objects, or an object
with a `problems` array. For example:

```json
{
  "id": "my_conjunction",
  "statement": "theorem my_conjunction (P Q : Prop) (hP : P) (hQ : Q) : P ∧ Q",
  "imports": ["Mathlib"],
  "opens": []
}
```

The statement contains the complete original theorem declaration through its
result type, without `:= by` or a proof. The identifier must match the theorem
name. Imports are restricted to pinned Mathlib, Std, and Init, plus the exact
reviewed definitions module `FormalVerify.Examples.TokenModel`. Example proof
modules and miniF2F answer modules are refused. The trusted observation bridge
is added by the runtime. Optional
`statementHash` or the benchmark provenance's `statementSha256` is checked
against the exact UTF-8 statement before search begins. Whitespace is significant
for this integrity check.

### Default resource limits

`DEFAULT_BUDGET` in `src/engine.mjs` is the executable source of truth. Each result
also records the actual limits used.

| Resource | Default |
| --- | ---: |
| Compiler calls per theorem, including final verification | 64 |
| Candidate proposal steps per theorem | 64 |
| Proposal rounds per node for an external proposer | 3 |
| Maximum recursion depth | 8 |
| Wall time per compiler call | 30 seconds |
| Wall time per theorem | 300 seconds |
| Lean heartbeat allowance | 200,000 |
| Model tokens | 0 |

The CLI exposes `--max-compiler-calls`, `--max-steps`, `--max-depth`,
`--max-proposal-rounds`, `--timeout-ms`, `--call-timeout-ms`, and `--heartbeats`.
Every result records the effective values. The explicit Codex proposer defaults
to a 50,000-token response-admission allowance, adjustable with
`--model-token-budget`; this does not impose a provider billing cap on a request
already in flight.

Children and failed branches consume the same theorem-wide allowance. Failed
work is not refunded. Two compiler calls are reserved for complete standalone
verification. A compiler call may itself execute several tactics inside Lean's
`solve` combinator; the compiler-call count is not a count of primitive tactics.
When the final gate rejects a locally closed proof, search resumes through its
continuations with the same remaining budget. It can revisit earlier siblings
and failed decompositions; see [search and repair](docs/search.md).

A timeout, rejected candidate, or exhausted search is a failure of this bounded
attempt. It does not establish that a theorem is false or unprovable.

## Independently verify a saved proof

```sh
node formal/src/cli.mjs verify benchmarks/tier1.json \
  .fva/examples/conjunction/conjunction_commutation.lean \
  --id conjunction_commutation
```

Verification requires the original problem manifest. It cannot silently replace
the statement with a theorem extracted from the candidate file. For a dataset,
`--id` may be omitted if the proof's fixed audit suffix uniquely identifies an
entry in that manifest.

The CLI validates the locked imports, statement, heartbeat setting, indentation,
proof tokens, and mandatory audit. It copies the validated bytes to a fresh
read-only temporary file and compiles that snapshot using the pinned project.
It also checks that the supplied file did not change during verification. The
heartbeat value is read from the proof's scaffold; this command checks proof
validity, not the historical budget or search statistics of an earlier run.

`VERIFIED` requires compiler exit code `0`, no compiler errors or disallowed
warnings, and a successful audit of the named theorem in Lean's checked kernel
environment. The only permitted warning is the exact pinned unused-variable
linter message. It remains in the verification receipt; unknown warnings fail.
The audit follows transitive constant dependencies and permits only `propext`,
`Classical.choice`, and `Quot.sound` as foundational axioms. Imported placeholder
proofs and newly introduced axioms fail this audit. The proof guard separately
rejects placeholder tokens, declaration injection, native evaluation shortcuts,
and changes to the original statement.

Exit codes are `0` for complete success, `1` for a failed proof attempt,
verification, or doctor check, and `2` for malformed input or invocation errors.

## Connect an explicit proposer

### Codex CLI

```sh
codex login
node formal/src/cli.mjs doctor --proposer codex
node formal/src/cli.mjs solve benchmarks/tier1.json \
  --id conjunction_commutation --proposer codex --compiler worker \
  --model-token-budget 50000 --out .fva/examples/codex-conjunction
```

Use `--model MODEL_ID` to choose a model explicitly; omission uses the existing
Codex configuration and records that the requested model ID is unknown. The
adapter uses a separate temporary working directory, disables execution tools,
apps, plugins, web search and configured MCP servers, and requests structured
tactic or `have` proposals. Only actual `turn.completed` usage is counted; the
model cannot invent its own token count. See [Codex proposer](docs/codex-proposer.md)
for limitations and the live validation run.

There is no automatic provider fallback. A failed preflight is an unavailable
model comparison, not a theorem-proving score. `doctor` checks prerequisites
without spending model tokens.

### Trusted local command

The generic command adapter accepts a JSON argv array and is launched directly,
without shell expansion. It remains useful for other providers or application
integration; the command is part of the trusted local environment.

```sh
node formal/src/cli.mjs solve benchmarks/minif2f.json \
  --id mathd_algebra_107 \
  --out .fva/examples/model107 \
  --proposer-command '["node","/absolute/path/to/my-proposer.mjs"]' \
  --model-token-budget 8000
```

Each invocation receives one JSON object on standard input:

```json
{
  "protocol": 1,
  "goal": {
    "target": "Q ∧ P",
    "targetHead": "And",
    "hypotheses": [
      {"name": "hP", "type": "P", "isProp": true},
      {"name": "hQ", "type": "Q", "isProp": true}
    ]
  },
  "imports": ["Mathlib"],
  "feedback": [],
  "budget": {
    "compilerCallsRemaining": 60,
    "maxDepth": 8,
    "depth": 1,
    "modelTokensRemaining": 8000,
    "remainingMs": 170000
  }
}
```

This example abbreviates the full Lean goal record. Actual records also carry
local declaration types, visible let values, dependency identities, universe
parameters, and formatted state. A child receives its current local context and
imports, without the parent transcript, sibling states, ancestor candidates, or
benchmark solutions. Its own recent failed proposals and compiler diagnostics
are returned in `feedback` for subsequent proposal rounds. All visible local
assumptions and their dependencies are
preserved conservatively; the runtime does not guess that an assumption is
irrelevant. Precise proof context remains in Lean and is replayed from the
original statement, not reconstructed from the displayed text.

The command must exit successfully and write one complete JSON response to
standard output. Diagnostic logging belongs on standard error.

```json
{
  "proposals": [
    {"tactic": "constructor"},
    {"kind": "have", "name": "aux", "type": "P"}
  ],
  "modelTokens": 120
}
```

A tactic can close a goal or produce compiler-observed child goals. A `have`
proposal creates a child to prove the stated local lemma, then a continuation
that may use it. The lemma's type and every proposal are checked before use.
An unsuccessful child causes the branch to be pruned and the parent tree to be
restored. The final theorem is compiled again even when every local child
appears closed.

`modelTokens` must report the actual usage of that invocation. The engine shares
and checks the remaining allowance across children and rejects over-budget
responses. The external adapter is responsible for constraining its model
request before spending tokens; the engine cannot independently meter a remote
provider or verify a command's self-reported usage. A purely local deterministic
adapter reports zero. The default model budget remains zero unless explicitly
changed.

### Persistent exploration

`--compiler worker` enables a persistent Lean process that caches imports and
starts a fresh elaboration state for every candidate. The default `process`
backend uses fresh processes throughout. Both modes suspend cached exploration
resources before the two fresh final compiler checks. A changed environment,
worker crash, timeout or malformed response cannot be accepted as a proof.
See [worker ownership, cache validation, and measurements](docs/persistent-worker.md).

## Evidence and trust boundary

A run retains numbered attempt `.lean` files, raw compiler output with parsed
locations and failure categories, individual context packets, evidence hashes,
a proof tree, branch restoration hashes, resource usage, and final verification
receipts. Failed exploration files are intentionally noncompiling and remain
under `attempts/` or have the `.failed.lean` suffix. They are not solved proofs.

Open nodes are labeled `ELABORATOR_OBSERVED`; this means a tactic prefix exposed
a particular Lean state. It is not a kernel proof certificate. Nodes retained
in an accepted complete theorem become `VERIFIED_IN_FINAL_PROOF`. `SOLVED` is
published only after two fresh compiler processes accept the complete guarded
standalone source with its dependency audit.

The trusted base includes the pinned Lean installation, the pinned library
artifacts, this bridge and verifier, and any explicitly selected local proposer
command. Process-group timeout cleanup is exercised on Linux and macOS. This is not an
operating-system sandbox for hostile Lean metaprograms, compromised imported
libraries, or an untrusted external executable. Other platforms require their
own process-cleanup validation before equivalent containment claims are made.

The [atomic-token example](../examples/security/README.md) proves conservation
and at-most-once success in an explicitly defined transition model. It includes
standalone audited proofs and two isolated proof-search manifests. This is a
model property, with no claim about an implementation or network delivery.

## Tests

```sh
npm test --prefix formal
FVA_INTEGRATION=1 npm test --prefix formal
```

The second command requires the installed Lean toolchain and built bridge. It
runs real compiler checks for recursive contexts, successful sublemmas, failed
branch restoration, budgets, signature guards, and rejected proof shortcuts.
The complete miniF2F run is separate from these integration regressions.
