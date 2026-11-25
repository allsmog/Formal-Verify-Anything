import FormalVerify.Examples.TokenModel
import Mathlib.Tactic.NormNum
import FormalVerify.Bridge

open FormalVerify.Examples.AtomicToken
set_option maxHeartbeats 200000

theorem token_authorization_at_most_once
    (outcomes : List Outcome) (final : TokenState)
    (execution : Trace .fresh outcomes final) :
    successes outcomes ≤ 1  := by
  have conservation : ∀ (initialState finalState : TokenState) (events : List Outcome),
    Trace initialState events finalState →
      successes events + remaining finalState = remaining initialState := by
    intro initialState finalState events executionTrace
    induction executionTrace with
    | nil state =>
        cases state <;> rfl
    | cons first _rest ih =>
        cases first <;> simp_all [successes, remaining]
  fva_probe "n2"
