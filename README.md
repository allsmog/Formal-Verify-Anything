# Formal Verify Anything

Bounded, compiler-grounded proof search for Lean 4. A proposal policy suggests
proof steps, Lean decides whether they work, and a proof is accepted only after
two fresh compilations and a kernel dependency audit.

**The default solver is a deterministic tactic-search baseline.** It makes no
model calls. An explicit Codex CLI adapter or a trusted local command can supply
model-generated proposals with scoped goal context and compiler feedback; those
proposals receive the same validation. Deterministic scores and fixture tests
are never presented as measured model performance.

Version 0.2 includes final-verification-aware repair, an optional persistent Lean
exploration worker, a frozen 24-problem holdout comparison, and an audited
atomic-token security model.

## Run it

Prerequisites: Node.js 22 or later, Git, and [elan](https://github.com/leanprover/elan).
The repository pins Lean 4.24.0 and an exact Mathlib commit.

```sh
git clone https://github.com/allsmog/Formal-Verify-Anything.git
cd Formal-Verify-Anything
npm ci --prefix formal
lake exe cache get
lake build
node formal/src/cli.mjs doctor
node formal/src/cli.mjs solve benchmarks/tier1.json --id conjunction_commutation
```

The `formal/` runtime is plain JavaScript with no npm dependencies.

## What the proof runner does

1. Locks the original theorem declaration, imports, and statement hash.
2. Asks Lean to report the current target, hypotheses, dependent lets, universe
   parameters, and goal structure.
3. Sends only that local context to a proposal policy. Proposals can use tactics,
   case/induction splits, or a structured `have` sublemma with a continuation.
4. Replays each branch in a fresh file containing the original theorem. Failed
   branches restore the exact parent plan; every attempt retains its source,
   diagnostics, exit code, elapsed time, and evidence digest.
5. Shares compiler-call, proposal-step, depth, heartbeat, model-token, and wall-time
   budgets across the entire recursion tree.
6. Emits a solved proof only after two fresh standalone compiler invocations
   succeed, its original declaration is unchanged, and a dependency audit accepts
   its kernel theorem declaration.

If final verification rejects a locally closed proof, search resumes with the
remaining shared budget and compiler feedback. It can repair an earlier sibling
or change a decomposition. `--compiler worker` reuses imported libraries during
exploration, while both final checks still run in fresh Lean processes.

Intermediate probes intentionally fail with a private sentinel after reporting
their goals. An elaborator-observed state is not a solved theorem. Earlier
compiler errors invalidate a probe even if later error recovery reports no goals.

The final gate rejects `sorry`, `admit`, new `axiom` declarations, lexical escapes,
arbitrary elaborator commands, and compiler-trust shortcuts. It checks the
transitive proof dependencies and permits only Lean's usual foundational axioms:
`propext`, `Classical.choice`, and `Quot.sound`.
Only the exact unused-variable linter warning is permitted under the v2 policy;
it remains visible in the receipt. Other warnings remain rejections.

## Benchmarks and verification

```sh
# Meaningful unit and real Lean integration checks
FVA_INTEGRATION=1 npm test --prefix formal

# Frozen 24-problem v2 evaluation, with a real provider-availability preflight
node benchmarks/v2/run.mjs --provider both --compiler worker

# Diagnostic v1 reruns never overwrite the published v1 results
node benchmarks/run.mjs --only mathd_algebra_142
```

[benchmarks/results.md](benchmarks/results.md) contains the measured outcomes,
budget, per-theorem compiler calls and recursion depth, failures, and links to
every generated proof and attempt. The twelve miniF2F test statements were
selected by filename before any solver runs. Every selected failure remains in
the denominator. See [benchmark provenance](benchmarks/README.md).

The canonical **v1** baseline accepted **5/5 foundational theorems and 8/12 miniF2F
problems: 13/17 overall (76.5%)**. It made **414 compiler calls**, reached recursion
depth **8**, and used **0 model tokens**. All four failures exhausted the
compiler-call budget.

The [v2 evaluation](benchmarks/v2/README.md) uses eight algebra, eight number-theory
and eight induction statements, disjoint from those twelve miniF2F items. Its
selection and exact declarations were frozen before any v2 search. In the paired
run, each method got one bounded invocation per theorem under the same limits:

| Method | Solved (pass@1) | Compiler calls | Model tokens |
| --- | ---: | ---: | ---: |
| Codex CLI proposer | **17/24** (70.8%) | 97 | 471,764 reported |
| Deterministic policy | **11/24** (45.8%) | 979 | 0 |

Codex solved every theorem the deterministic policy solved, plus six more. Four
Codex invocations ended in provider timeouts that reported no token usage, so
the token total is a lower bound. The [v2 report](benchmarks/v2/results.md) breaks
results down by algebra, number theory, and induction, and links every proof and
trace. A blocked provider preflight would be reported separately and never
converted into a model score.

Here `pass@1` means one invocation of the **whole bounded search policy** per
theorem. It includes that invocation's internal backtracking. First-candidate
success is reported separately. Exhausting the search does not show that the
theorem is false or unprovable.

CI requires the canonical report and all seventeen expected IDs, then recompiles
every recorded successful proof. To run the same integrity gate locally:

```sh
node formal/scripts/recheck.mjs
```

## Select a proposer or compiler

```sh
# Existing Codex authentication (ChatGPT login or API key) is required
node formal/src/cli.mjs doctor --proposer codex
node formal/src/cli.mjs solve benchmarks/tier1.json \
  --id conjunction_commutation --proposer codex --compiler worker \
  --model-token-budget 50000

# Deterministic worker mode requires no model account
node formal/src/cli.mjs solve benchmarks/tier1.json --compiler worker
```

The CLI supports a trusted local command that receives one scoped JSON request
on stdin and returns proposals plus measured token usage. It is launched with an
argument vector, without a shell. See [formal/README.md](formal/README.md) for the
protocol, command-line options, and independent proof verification.
The [Codex adapter](formal/docs/codex-proposer.md) records actual provider usage,
malformed responses and unavailable usage without inventing zero-cost requests.
The token allowance is an admission threshold, not a provider billing cap.
The [worker guide](formal/docs/persistent-worker.md) documents cache isolation,
resource ownership and complete-workflow measurements.

No original benchmark proof bodies are available to the policy. Imports of
`MiniF2F` modules are forbidden, preventing accidental reuse of benchmark answers
or admitted declarations.

## Security example

[The atomic-token example](examples/security/README.md) defines a fresh/spent
state machine with authorized consumption and denied self-loops. Its four
audited proofs establish conservation across finite traces, at-most-once
success, refusal of reuse after consumption, and impossibility of two successes.
Separate problem manifests import only definitions, so a proof-search run cannot
reuse the example's completed proof module. The claims concern this abstract
atomic model; they do not establish correctness of a Rust implementation or
exactly-once network delivery.

## Scope and limits

This is a working bounded proof-search system, not a guarantee that arbitrary
Lean theorems will be solved. The generic policy is deliberately small. Case
goals coupled by shared metavariables can make a proposed bullet layout stale;
the runner conservatively rejects those branches. Context retains all visible
local hypotheses and their dependencies; it does not guess which mathematical
premises are dispensable.

Lean, pinned Mathlib artifacts, the observation bridge, and the configured local
proposer command belong to the trusted computing environment. Tactic admission
and kernel checks are not an operating-system sandbox for hostile Lean plugins
or hostile local commands. Process-group timeout handling is tested on Linux and
macOS; Windows process-family cleanup has not been validated.

## Layout and licenses

- [formal/](formal/): the JavaScript orchestration, proposers and CLI.
- [FormalVerify/Bridge.lean](FormalVerify/Bridge.lean): Lean goal observations and the kernel audit.
- [benchmarks/](benchmarks/): the v1 and v2 suites, protocols, results and full run traces.
- [examples/security/](examples/security/): the atomic-token model and its proof tasks.
- [SECURITY.md](SECURITY.md): how to report a vulnerability and what the runner does not protect against.
- [LICENSE](LICENSE): MIT. Benchmark statements keep their miniF2F notices in
  [benchmarks/licenses/](benchmarks/licenses/).
