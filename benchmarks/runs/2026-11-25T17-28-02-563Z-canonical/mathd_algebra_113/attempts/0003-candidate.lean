import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_113
  (x : ℝ) :
  x^2 - 14 * x + 3 ≥ 7^2 - 14 * 7 + 3  := by
  rfl
  fva_done "n0"
