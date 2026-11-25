import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_143
  (f g : ℝ → ℝ)
  (h₀ : ∀ x, f x = x + 1)
  (h₁ : ∀ x, g x = x^2 + 3) :
  f (g 2) = 8  := by
  simp_all
  ·
    assumption
    fva_done "n1"
