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

theorem mathd_algebra_332
  (x y : ℝ)
  (h₀ : (x + y) / 2 = 7)
  (h₁ : Real.sqrt (x * y) = Real.sqrt 19) :
  x^2 + y^2 = 158  := by
  have hs : x + y = 14 := by linarith
  have hpos : 0 < Real.sqrt (19 : ℝ) := by positivity
  have hx : 0 ≤ x * y := by
    apply le_of_not_gt
    intro hn
    have hz := Real.sqrt_eq_zero_of_nonpos (le_of_lt hn)
    linarith [h₁, hz]
  have hp : x * y = 19 := by
    have hsq : (Real.sqrt (x * y)) ^ 2 = (Real.sqrt 19) ^ 2 := congrArg (fun t : ℝ => t ^ 2) h₁
    simpa only [Real.sq_sqrt hx, Real.sq_sqrt (show (0 : ℝ) ≤ 19 by norm_num)] using hsq
  have hsumSq : (x + y) ^ 2 = 196 := by rw [hs] <;> norm_num
  nlinarith [hsumSq, hp]

#fva_audit mathd_algebra_332
