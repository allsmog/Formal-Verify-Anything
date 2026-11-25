import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem mathd_algebra_176
  (x : ℝ) :
  (x + 1)^2 * x = x^3 + 2 * x^2 + x  := by
  fva_probe "declaration_mathd_algebra_176"

theorem mathd_algebra_362
  (a b : ℝ)
  (h₀ : a^2 * b^3 = 32 / 27)
  (h₁ : a / b^3 = 27 / 4) :
  a + b = 8 / 3  := by
  fva_probe "declaration_mathd_algebra_362"

theorem mathd_algebra_440
  (x : ℝ)
  (h₀ : 3 / 2 / 3 = x / 10) :
  x = 5  := by
  fva_probe "declaration_mathd_algebra_440"

theorem mathd_algebra_432
  (x : ℝ) :
  (x + 3) * (2 * x - 6) = 2 * x^2 - 18  := by
  fva_probe "declaration_mathd_algebra_432"

theorem mathd_numbertheory_293
  (n : ℕ)
  (h₀ : n ≤ 9)
  (h₁ : 11∣20 * 100 + 10 * n + 7) :
  n = 5  := by
  fva_probe "declaration_mathd_numbertheory_293"

theorem mathd_numbertheory_247
  (n : ℕ)
  (h₀ : (3 * n) % 11 = 2) :
  n % 11 = 8  := by
  fva_probe "declaration_mathd_numbertheory_247"

theorem mathd_numbertheory_582
  (n : ℕ)
  (h₀ : 0 < n)
  (h₁ : 3∣n) :
  ((n + 4) + (n + 6) + (n + 8)) % 9 = 0  := by
  fva_probe "declaration_mathd_numbertheory_582"

theorem mathd_numbertheory_229 :
  (5^30) % 7 = 1  := by
  fva_probe "declaration_mathd_numbertheory_229"

theorem mathd_numbertheory_212 :
  (16^17 * 17^18 * 18^19) % 10 = 8  := by
  fva_probe "declaration_mathd_numbertheory_212"

theorem induction_1pxpownlt1pnx
  (x : ℝ)
  (n : ℕ)
  (h₀ : -1 < x)
  (h₁ : 0 < n) :
  (1 + ↑n*x) ≤ (1 + x)^(n:ℕ)  := by
  fva_probe "declaration_induction_1pxpownlt1pnx"

theorem induction_12dvd4expnp1p20
  (n : ℕ) :
  12 ∣ 4^(n+1) + 20  := by
  fva_probe "declaration_induction_12dvd4expnp1p20"

theorem induction_11div10tonmn1ton
  (n : ℕ) :
  11 ∣ (10^n - (-1 : ℤ)^n)  := by
  fva_probe "declaration_induction_11div10tonmn1ton"
