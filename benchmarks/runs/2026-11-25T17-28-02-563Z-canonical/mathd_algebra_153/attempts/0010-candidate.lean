import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Archimedean
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_153
  (n : ℝ)
  (h₀ : n = 1 / 3) :
  Int.floor (10 * n) + Int.floor (100 * n) + Int.floor (1000 * n) + Int.floor (10000 * n) = 3702  := by
  simp_all
  ·
    norm_num at *
    fva_done "n1"
