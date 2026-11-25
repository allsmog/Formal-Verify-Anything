import FormalVerify.Examples.TokenModel
import Mathlib.Tactic.NormNum
import FormalVerify.Bridge

open FormalVerify.Examples.AtomicToken
set_option maxHeartbeats 200000

theorem token_authorization_at_most_once
    (outcomes : List Outcome) (final : TokenState)
    (execution : Trace .fresh outcomes final) :
    successes outcomes ≤ 1  := by
  fva_probe "n0"
