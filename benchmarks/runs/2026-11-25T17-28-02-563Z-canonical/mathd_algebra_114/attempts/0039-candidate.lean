import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Analysis.SpecialFunctions.Pow.Real
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_114
  (a : ℝ)
  (h₀ : a = 8) :
  (16 * (a^2) ^ (1 / 3 : ℝ)) ^ (1 / 3 : ℝ) = 4  := by
  simp_all
  ·
    norm_num at *
    ·
      simp_all
      ·
        ring
        ·
          simp_all
          ·
            norm_cast at *
            fva_done "n6"
