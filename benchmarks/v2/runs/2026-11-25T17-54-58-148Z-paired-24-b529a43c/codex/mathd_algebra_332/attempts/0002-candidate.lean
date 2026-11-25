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
  have hx : 0 ≤ x * y := by
    apply le_of_lt
    apply Real.sqrt_pos.mp
    rw [h₁]
    positivity
  have hp : x * y = 19 := by
    calc
      x * y = (Real.sqrt (x * y)) ^ 2 := (Real.sq_sqrt hx).symm
      _ = (Real.sqrt 19) ^ 2 := by rw [h₁]
      _ = 19 := Real.sq_sqrt (by norm_num)
  calc
    x ^ 2 + y ^ 2 = (x + y) ^ 2 - 2 * (x * y) := by ring
    _ = 158 := by rw [hs, hp] <;> norm_num
  fva_done "n0"
