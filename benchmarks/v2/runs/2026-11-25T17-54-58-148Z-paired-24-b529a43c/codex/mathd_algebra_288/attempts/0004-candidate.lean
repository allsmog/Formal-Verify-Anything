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
    simpa only [abs_of_neg h₀.2, neg_eq_iff_eq_neg] using h₁
  have hd := Real.sq_sqrt (add_nonneg (sq_nonneg (x - 8)) (sq_nonneg (y - 3)))
  rw [h₂, hy] at hd
  have hx : x = -4 := by
    have hf : (x + 4) * (x - 20) = 0 := by nlinarith only [hd]
    have hne : x - 20 ≠ 0 := by linarith only [h₀.1]
    have hz := (mul_eq_zero.mp hf).resolve_right hne
    linarith only [hz]
  have hr : (n : ℝ) = 52 := by
    have hn := congrArg (fun z : ℝ => z ^ 2) h₃
    change (Real.sqrt (x ^ 2 + y ^ 2)) ^ 2 = (Real.sqrt (n : ℝ)) ^ 2 at hn
    rw [Real.sq_sqrt (add_nonneg (sq_nonneg x) (sq_nonneg y)), Real.sq_sqrt (show 0 ≤ (n : ℝ) by positivity)] at hn
    rw [← hn, hx, hy]
    norm_num
  exact_mod_cast hr
  fva_done "n0"
