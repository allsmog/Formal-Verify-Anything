import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem induction_1pxpownlt1pnx
  (x : ℝ)
  (n : ℕ)
  (h₀ : -1 < x)
  (h₁ : 0 < n) :
  (1 + ↑n*x) ≤ (1 + x)^(n:ℕ)  := by
  clear h₁
  have hx : 0 ≤ 1 + x := by linarith only [h₀]
  induction n with
  | zero => simp
  | succ k ih =>
      rw [Nat.cast_succ, pow_succ]
      calc
        1 + ((k : ℝ) + 1) * x ≤ (1 + (k : ℝ) * x) * (1 + x) := by
          apply sub_nonneg.mp
          have hdiff : (1 + (k : ℝ) * x) * (1 + x) - (1 + ((k : ℝ) + 1) * x) = (k : ℝ) * x ^ 2 := by ring
          rw [hdiff]
          exact mul_nonneg (by positivity) (sq_nonneg x)
        _ ≤ _ := mul_le_mul_of_nonneg_right ih hx
  fva_done "n0"
