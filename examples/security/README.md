# Atomic single-use authorization token

This example models **one already-issued token** with two states, `fresh` and
`spent`. A successful authorization changes `fresh` to `spent` in one atomic
transition. A rejected attempt leaves the state unchanged. There is no transition
that issues a second token, resets a spent token, or reports success from `spent`.

`FormalVerify/Examples/TokenModel.lean` contains only the transition system and
the definitions used to state its properties. The separate
[`AtomicToken.lean`](AtomicToken.lean) proof file proves:

- **Conservation:** successful authorizations plus remaining authorization
  credit equal the initial credit.
- **At most once:** every allowed finite trace beginning with a fresh token
  contains at most one successful authorization.
- **No reuse:** every allowed trace beginning with a spent token contains zero
  successful authorizations.
- **Two successes are impossible:** the concrete trace consisting of two
  successful authorizations cannot occur.

The trace theorem quantifies over arbitrary finite trace lengths. It is not a
bounded enumeration of a few schedules. Concurrent callers are represented by
their ordered atomic transitions; the model assumes that such a linearization
exists.

## What this establishes

The proof concerns the abstract state machine. It does **not** establish that a
Rust service, database transaction, network handler, or browser client implements
these transitions. In particular, a separate “check fresh” operation followed by
“mark spent” is outside this model: two callers could both pass the check before
either consumes the token. An implementation must make consumption and successful
authorization one linearizable operation to refine the model.

Token signatures, identity and scope binding, expiry, storage durability, process
crashes, authorization delivery, and retries of a downstream send are not modeled.
At-most-once authorization also does not imply exactly-once delivery or eventual
success. These are separate properties and would need additional state and proofs.

## Check the proof file

```sh
lake build FormalVerify.Examples.TokenModel FormalVerify.Bridge
lake env lean --json examples/security/AtomicToken.lean
```

The four `#fva_audit` commands ask the same trusted bridge used by the agent to
check the declarations and their axiom dependencies. A successful check must be
reported from the actual compiler output; the presence of this file alone is not
an execution result.

## Try the agent

[`token-conservation.json`](token-conservation.json) and
[`token-at-most-once.json`](token-at-most-once.json) provide the conservation and
at-most-once statements as fresh proof tasks. Their imports contain only the model
definitions and standard arithmetic tactics, **not this proof file**. The agent
must reconstruct a proof under its configured search and model budgets. The model
source is an explicitly trusted import, and its SHA-256 is recorded in the task
manifest.

## Reproduce the guided recursive demonstration

```sh
node examples/security/run.mjs
```

This runner supplies a **hand-specified deterministic proof strategy** for each
manifest. It invokes no model and is a guided integration demonstration, excluded
from benchmark scores and model comparisons. Its output is a new directory under
`examples/security/runs/`; `--out NEW_DIRECTORY` selects another new directory.
It never imports `AtomicToken.lean` or reuses the completed proof module.

The conservation strategy performs induction on the execution trace. For
at-most-once authorization, the policy proposes a structured `have conservation`
whose type quantifies over an arbitrary initial state, final state, and outcome
list. A child proves that generalized conservation lemma using introductions and
induction. The separate continuation specializes the proved lemma to the original
execution from `fresh` and derives the bound with `omega`. The runner checks the
recorded contexts: the lemma child cannot see its own unproved result; its
continuation can use the proved result.

The [recorded guided run](runs/2026-11-20T07-33-07-844Z-guided-demo/results.md)
completed both tasks:

| Task | Compiler calls | Maximum recursion depth | Runtime model tokens |
| --- | ---: | ---: | ---: |
| Trace conservation | 4 | 0 | 0 |
| At-most-once authorization | 7 | 1 | 0 |

Each final proof passed **two fresh standalone Lean compilations**, both with
exit code zero and matching successful kernel dependency audits. The run retains
all attempted sources, exact proposer contexts, the proof tree, and both final
audit receipts. Its input and execution hashes remained unchanged. These results
demonstrate that supplied guidance can pass through recursive composition and
independent verification; they do not measure autonomous theorem discovery or
live model performance.
