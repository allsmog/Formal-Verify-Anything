import FormalVerify.Examples.TokenModel
import Mathlib.Tactic.NormNum
import FormalVerify.Bridge

open FormalVerify.Examples.AtomicToken
set_option maxHeartbeats 200000

theorem token_trace_conservation
    {initial final : TokenState} {outcomes : List Outcome}
    (execution : Trace initial outcomes final) :
    successes outcomes + remaining final = remaining initial  := by
  induction execution with
  | nil state =>
      cases state <;> rfl
  | cons first _rest ih =>
      cases first <;> simp_all [successes, remaining]

#fva_audit token_trace_conservation
