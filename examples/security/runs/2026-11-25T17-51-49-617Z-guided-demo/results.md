# Guided atomic-token proof demonstration

Status: **VERIFIED_GUIDED_DEMO**. Policy: `guided-token-demo-v1`.

Fixed development-supplied proof strategies for two abstract atomic-token properties. This is not autonomous discovery, a public benchmark score, an LLM evaluation, or implementation verification.

The proposer is a hand-specified deterministic proof strategy. It makes zero runtime model calls. Each task starts with a separate proof tree and budget, imports only the token model and ordinary arithmetic tactics, and receives both fresh standalone final checks. The completed `AtomicToken.lean` proofs are not imported.

| Theorem | Status | Compiler calls | Maximum depth | Model tokens | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| token_trace_conservation | SOLVED | 4 | 0 | 0 | [trace](token_trace_conservation/result.json) · [proof](token_trace_conservation/token_trace_conservation.lean) |
| token_authorization_at_most_once | SOLVED | 7 | 1 | 0 | [trace](token_authorization_at_most_once/result.json) · [proof](token_authorization_at_most_once/token_authorization_at_most_once.lean) |

The conservation task receives a direct induction strategy. The at-most-once task receives a structured `have conservation` proposal for a generalized conservation theorem. Its child introduces the generalized variables and proves the lemma by induction; its separate continuation applies the proved lemma to the original execution and finishes with `omega`. The trace verifies that the child cannot see its own unproved lemma, while the continuation can.

This demonstration tests recursive composition and kernel admission using supplied guidance. It is excluded from all benchmark pass rates and model comparisons. The properties describe the abstract atomic state machine; they do not verify a concrete service, its linearizability, or network delivery.

Recorded execution and input bytes unchanged: **true**. Detailed source/artifact hashes and both final audit receipts are in [results.json](results.json).
