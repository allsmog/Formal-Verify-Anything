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
  have hprod : x * y = (19 : ℝ) := by
    have h19 : 0 < Real.sqrt (19 : ℝ) := Real.sqrt_pos.mpr (by norm_num)
    have hxy : 0 ≤ x * y := (Real.sqrt_pos.mp (h₁.symm ▸ h19)).le
    calc
      x * y = (Real.sqrt (x * y)) ^ 2 := (Real.sq_sqrt hxy).symm
      _ = (Real.sqrt 19) ^ 2 := congrArg (fun t : ℝ => t ^ 2) h₁
      _ = 19 := Real.sq_sqrt (by norm_num)
  fva_probe "n2"
