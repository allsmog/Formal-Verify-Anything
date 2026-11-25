import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_129
  (a : ℝ)
  (h₀ : a ≠ 0)
  (h₁ : 8⁻¹ / 4⁻¹ - a⁻¹ = 1) :
  a = -2  := by
  simp_all
  ·
    norm_num at *
    ·
      simp_all
      ·
        norm_cast at *
        ·
          simp_all
          ·
            norm_num at *
            ·
              norm_cast at *
              ·
                omega
                fva_done "n10"
