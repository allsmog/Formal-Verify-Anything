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
  fva_probe "declaration_mathd_algebra_293"

theorem mathd_algebra_320
  (x : ℝ)
  (a b c : ℕ)
  (h₀ : 0 < a ∧ 0 < b ∧ 0 < c ∧ 0 ≤ x)
  (h₁ : 2 * x^2 = 4 * x + 9)
  (h₂ : x = (a + Real.sqrt b) / c)
  (h₃ : c = 2) :
  a + b + c = 26  := by
  fva_probe "declaration_mathd_algebra_320"

theorem mathd_algebra_332
  (x y : ℝ)
  (h₀ : (x + y) / 2 = 7)
  (h₁ : Real.sqrt (x * y) = Real.sqrt 19) :
  x^2 + y^2 = 158  := by
  fva_probe "declaration_mathd_algebra_332"

theorem mathd_algebra_288
  (x y : ℝ)
  (n : NNReal)
  (h₀ : x < 0 ∧ y < 0)
  (h₁ : abs y = 6)
  (h₂ : Real.sqrt ((x - 8)^2 + (y - 3)^2) = 15)
  (h₃ : Real.sqrt (x^2 + y^2) = Real.sqrt n) :
  n = 52  := by
  fva_probe "declaration_mathd_algebra_288"
