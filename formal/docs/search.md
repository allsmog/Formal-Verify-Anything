# Search, final verification, and repair

The search engine uses Lean observations to propose and compose proofs. A closed
exploratory goal is provisional: a theorem becomes `SOLVED` only after its
complete, guarded standalone source passes two fresh compiler invocations and
the kernel dependency audit. The engine version is `fva-search-v2`; final
admission uses `lean-kernel-v2-unused-variable-lint`. Historical v1 benchmark
artifacts retain their original policy and results.

The owning implementations are [`engine.mjs`](../src/engine.mjs),
[`compiler.mjs`](../src/compiler.mjs), and [`guard.mjs`](../src/guard.mjs).

## Recursive search and recovery

Each open node is elaborated in its complete source context. The bridge reports
its target and local hypotheses, then deliberately stops elaboration with an
exact, engine-generated sentinel. An observation is usable only if the expected
state and sentinel are present, all errors belong to generated probes, and the
transport is complete. An earlier Lean error disqualifies a later state report.

The proposer receives one goal, its hypotheses, imported module names, remaining
budgets, and feedback from failed proposals for that same node and state. It
receives no parent conversation, sibling transcript, complete proof file, or
benchmark proof. Each exact request and response is saved separately. Introduced
variable names remain intact in evidence; attempt-path hygiene suffixes are
excluded only from the cycle and no-progress comparison.

A tactic can close the node or expose child goals. A `have` proposal creates a
child for the intermediate lemma and another for its continuation. Lean determines
which hypotheses are visible to each child; the new lemma is available only in
the continuation. Branches use immutable tree snapshots, and every rejected
branch records matching before/restored hashes.

Search is depth-first with continuations. Solving a child continues through its
remaining siblings and eventually final verification. A failed final check
returns through that same chain, allowing alternatives in the last child, an
earlier sibling, or an ancestor decomposition. A later proposer round can use the
final diagnostic attached to its rejected branch. This is bounded repair: the
engine does not restart with a new budget or accept the first local closure as a
finished theorem.

The same node may be visited again with a different dependent context. Evidence
identifies node visits with `visit` and `stateHash`; consumers must not collapse
all records by node ID. Only the accepted continuation marks its participating
visits `VERIFIED_IN_FINAL_PROOF`.

## Independent admission

For each complete candidate, the engine performs these checks in order:

1. Reconstruct and validate the exact original declaration, imports, heartbeat
   setting, proof indentation, and mandatory audit command. Forbidden proof
   placeholders, added declarations, and execution escapes are rejected.
2. Suspend an exploratory worker, if its session exposes `suspend()`, releasing
   resident imported environments before independent compilation. Suspension
   failure stops admission and retains cleanup ownership.
3. Run fresh `lake env lean --json` processes for `final` and `recheck`.
4. Require exit code zero, complete output, no substantive errors or rejected
   warnings, and the matching successful kernel audit from each process.
5. Atomically publish the standalone proof and its verification receipt.

The only permitted warning is the complete pinned Lean unused-variable linter
diagnostic, including its standard linter-disable note. The warning remains in
the receipt. Partial matches, unused-tactic warnings, and unknown warnings remain
rejections. This policy changes admission of benign lint; it does not relax the
kernel audit or placeholder prohibition. The audit permits only the standard
Lean foundations `propext`, `Classical.choice`, and `Quot.sound` in the theorem's
transitive axiom dependencies.

Every complete candidate is retained in `finalCandidates`, including its plan
and source hashes, check assessments, evidence IDs, and rejection reason. A
failed first check does not spend the second check. Both checks must succeed for
an accepted candidate, even when exploration reports a false closure.

## Budgets and model accounting

The shared `Budget` counter in `src/support.mjs` accounts for compiler calls, proposal
steps, and model tokens across the entire theorem search. Exploration reserves
two compiler calls for final admission. Rejected work is charged and never
refunded. Time limits, recursion depth, and proposal-round limits remain active
while backtracking. Repeated identical proposals within a node visit are skipped.

`proposerCalls` preserves the provider identity, reported policy, actual usage,
metadata, request digest, and precise failure category. Usage is accounted for
before proposal validation, so malformed or over-budget responses retain their
incurred cost. When provider usage is unavailable, `metrics.modelTokens` is
`null`, `modelUsageComplete` is false, and `modelTokensKnown` retains the known
subtotal. Unknown spend stops further model search; it is never represented as
zero. The token allowance is a response-admission threshold, not a provider
billing cap for an already-running request.

The default proposer is deterministic and uses zero model tokens. A model-backed
proposer must be selected explicitly. Neither a simulated provider test nor an
unavailable-provider preflight establishes live model performance.

## Exploration session ownership

`solveTheorem` accepts one optional exploration backend:

| Option | Contract | Owner |
| --- | --- | --- |
| `explorationCompiler` | Async function taking a complete compilation request | Caller |
| `explorationSession` | Object with `compile(request)` and optional `suspend()` | Caller |
| `explorationSessionFactory` | Factory returning a session with `compile(request)` and `close()` | Engine |

Requests contain the exact source and source path, node and attempt kind,
project root, and remaining time/output limits. Results use `compileLean`'s
structured result contract. An injected backend receives only exploration
requests; final verification always calls the fresh CLI implementation directly.

The engine closes sessions it creates in `finally`; callers close sessions they
supply. An engine-owned cleanup failure is recorded and exposes the
non-enumerable `result.retryExplorationCleanup()` capability, retaining that
exact owner until cleanup succeeds. This capability is not serialized into the
JSON artifact. See [persistent-worker.md](persistent-worker.md) for caching,
suspension, process ownership, and invalidation details.

## Focused verification

```sh
node --test formal/test/security.test.mjs
FVA_INTEGRATION=1 node --test formal/test/integration.test.mjs
```

The integration cases exercise real Lean rollback, isolated child contexts,
shared budgets, kernel rejection of admitted terms and new axioms, rejection of
earlier compiler errors, and exact statement preservation. Deliberately
untrustworthy exploration fixtures report false closures; fresh Lean then
rejects them, and the search repairs both a root candidate and an earlier
sibling. Additional cases verify final-budget exhaustion and admission of real
unused-variable lint. The security checks cover exact warning matching, actual
or unknown token accounting, and resource ownership after suspension or cleanup
failure.
