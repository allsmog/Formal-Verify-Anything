import Init

/-!
An abstract atomic state machine for one already-issued authorization token.
The state transition is the linearization point of an authorization attempt.
This module contains definitions only; it imports no benchmark or example proofs.
-/

namespace FormalVerify.Examples.AtomicToken

inductive TokenState where
  | fresh
  | spent
  deriving DecidableEq, Repr

inductive Outcome where
  | authorized
  | denied
  deriving DecidableEq, Repr

/-- A successful authorization consumes the token in the same atomic step. -/
inductive Step : TokenState → Outcome → TokenState → Prop where
  | authorize : Step .fresh .authorized .spent
  | denyFresh : Step .fresh .denied .fresh
  | denySpent : Step .spent .denied .spent

/-- Every finite sequence of allowed atomic transitions, with arbitrary length. -/
inductive Trace : TokenState → List Outcome → TokenState → Prop where
  | nil (state : TokenState) : Trace state [] state
  | cons {before middle after : TokenState} {outcome : Outcome} {outcomes : List Outcome}
      (first : Step before outcome middle)
      (rest : Trace middle outcomes after) :
      Trace before (outcome :: outcomes) after

def remaining : TokenState → Nat
  | .fresh => 1
  | .spent => 0

def successes : List Outcome → Nat
  | [] => 0
  | .authorized :: rest => successes rest + 1
  | .denied :: rest => successes rest

end FormalVerify.Examples.AtomicToken
