import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_137
  (x : ℕ)
  (h₀ : ↑x + (4:ℝ) / (100:ℝ) * ↑x = 598) :
  x = 575  := by
  fva_probe "n0"
