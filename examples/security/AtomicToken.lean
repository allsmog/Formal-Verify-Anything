import FormalVerify.Examples.TokenModel
import FormalVerify.Bridge
import Mathlib.Tactic.NormNum

open FormalVerify.Examples.AtomicToken

theorem token_trace_conservation
    {initial final : TokenState} {outcomes : List Outcome}
    (execution : Trace initial outcomes final) :
    successes outcomes + remaining final = remaining initial := by
  induction execution with
  | nil state =>
      cases state <;> rfl
  | cons first _rest ih =>
      cases first <;> simp_all [successes, remaining]

theorem token_authorization_at_most_once
    (outcomes : List Outcome) (final : TokenState)
    (execution : Trace .fresh outcomes final) :
    successes outcomes ≤ 1 := by
  have conserved : successes outcomes + remaining final = 1 :=
    token_trace_conservation execution
  omega

theorem spent_token_never_authorizes
    (outcomes : List Outcome) (final : TokenState)
    (execution : Trace .spent outcomes final) :
    successes outcomes = 0 := by
  have conserved : successes outcomes + remaining final = 0 :=
    token_trace_conservation execution
  omega

theorem two_successful_authorizations_are_impossible
    (final : TokenState) :
    ¬ Trace .fresh [.authorized, .authorized] final := by
  intro execution
  have bound := token_authorization_at_most_once [.authorized, .authorized] final execution
  norm_num [successes] at bound

#fva_audit token_trace_conservation
#fva_audit token_authorization_at_most_once
#fva_audit spent_token_never_authorizes
#fva_audit two_successful_authorizations_are_impossible
