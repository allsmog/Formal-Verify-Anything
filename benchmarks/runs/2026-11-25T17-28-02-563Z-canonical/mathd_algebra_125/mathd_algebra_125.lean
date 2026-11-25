import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.Real.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem mathd_algebra_125
  (x y : ℕ)
  (h₀ : 0 < x ∧ 0 < y)
  (h₁ : 5 * x = y)
  (h₂ : (↑x - (3:ℤ)) + (y - (3:ℤ)) = 30) :
  x = 6  := by
  omega

#fva_audit mathd_algebra_125
