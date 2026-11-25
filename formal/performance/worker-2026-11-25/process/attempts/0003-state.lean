import Mathlib.Data.Real.Basic
import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem worker_measurement (a b : ℝ) (ha : 2 * a + 3 = 7) (hb : 3 * b - 1 = 8) : a = 2 ∧ b = 3 := by
  constructor
  ·
    fva_probe "n1"
  ·
    fva_probe "n2"
