import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Data.Real.Sqrt
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem mathd_algebra_288
  (x y : ℝ)
  (n : NNReal)
  (h₀ : x < 0 ∧ y < 0)
  (h₁ : abs y = 6)
  (h₂ : Real.sqrt ((x - 8)^2 + (y - 3)^2) = 15)
  (h₃ : Real.sqrt (x^2 + y^2) = Real.sqrt n) :
  n = 52  := by
  have hy : y = -6 := by
    rw [abs_of_neg h₀.2] at h₁
    linarith only [h₁]
  have hd := Real.sq_sqrt (add_nonneg (sq_nonneg (x - 8)) (sq_nonneg (y - 3)))
  rw [h₂, hy] at hd
  have hf : (x + 4) * (x - 20) = 0 := by
    nlinarith only [hd]
  have hx : x = -4 := by
    rcases mul_eq_zero.mp hf with h | h
    · linarith only [h]
    · linarith only [h, h₀.1]
  have hn := Real.sq_sqrt (add_nonneg (sq_nonneg x) (sq_nonneg y))
  rw [h₃, Real.sq_sqrt (show 0 ≤ (n : ℝ) from n.property), hx, hy] at hn
  apply Subtype.ext
  change (n : ℝ) = ((52 : NNReal) : ℝ)
  first | exact_mod_cast (show (n : ℝ) = 52 by norm_num at hn ⊢; exact hn) | norm_num at hn ⊢ <;> assumption

#fva_audit mathd_algebra_288
