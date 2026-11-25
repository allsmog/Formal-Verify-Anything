import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Data.Nat.Factorial.Basic
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem induction_nfactltnexpnm1ngt3
  (n : ℕ)
  (h₀ : 3 ≤ n) :
  (n)! < n^(n - 1)  := by
  revert h₀
  induction n with
  | zero =>
    intro hn
    omega
  | succ k ih =>
    intro hn
    by_cases hk : 3 ≤ k
    · have hPow : k ^ (k - 1) ≤ k.succ ^ (k - 1) := by
        first
        | exact Nat.pow_le_pow_left (Nat.le_succ k) _
        | gcongr <;> exact Nat.le_succ k
      calc
        k.succ.factorial = k.succ * k.factorial := Nat.factorial_succ k
        _ < k.succ * k.succ ^ (k - 1) :=
          mul_lt_mul_of_pos_left (lt_of_lt_of_le (ih hk) hPow) (Nat.zero_lt_succ k)
        _ = k.succ ^ (k - 1 + 1) := (pow_succ' _ _).symm
        _ = k.succ ^ (k.succ - 1) := congrArg (fun e : Nat => k.succ ^ e) (by omega)
    · have he : k = 2 := by omega
      subst k
      decide
  fva_done "n0"
