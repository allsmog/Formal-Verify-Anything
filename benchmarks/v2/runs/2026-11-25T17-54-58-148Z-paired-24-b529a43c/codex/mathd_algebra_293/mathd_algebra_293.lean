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

theorem mathd_algebra_293
  (x : NNReal) :
  Real.sqrt (60 * x) * Real.sqrt (12 * x) * Real.sqrt (63 * x) = 36 * x * Real.sqrt (35 * x)  := by
  rw [← Real.sqrt_mul (show 0 ≤ (60 : ℝ) * (x : ℝ) by positivity), ← Real.sqrt_mul (show 0 ≤ (60 : ℝ) * (x : ℝ) * (12 * (x : ℝ)) by positivity)]
  calc
    _ = Real.sqrt ((36 * (x : ℝ)) ^ 2 * (35 * (x : ℝ))) := by
      congr 1
      ring
    _ = _ := by
      rw [Real.sqrt_mul (show 0 ≤ (36 * (x : ℝ)) ^ 2 by positivity), Real.sqrt_sq (show 0 ≤ 36 * (x : ℝ) by positivity)]

#fva_audit mathd_algebra_293
