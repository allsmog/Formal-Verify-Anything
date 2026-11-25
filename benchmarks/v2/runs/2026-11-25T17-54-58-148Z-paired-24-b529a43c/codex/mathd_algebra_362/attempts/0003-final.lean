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

theorem mathd_algebra_362
  (a b : ℝ)
  (h₀ : a^2 * b^3 = 32 / 27)
  (h₁ : a / b^3 = 27 / 4) :
  a + b = 8 / 3  := by
  have hb_ne : b ^ 3 ≠ 0 := by
    intro hz
    rw [hz, mul_zero] at h₀
    norm_num at h₀
  have hmul : a = (27 / 4 : ℝ) * b ^ 3 := (div_eq_iff hb_ne).mp h₁
  have ha_cube : a ^ 3 = (8 : ℝ) := by
    calc
      a ^ 3 = a ^ 2 * ((27 / 4 : ℝ) * b ^ 3) := by rw [← hmul] <;> ring
      _ = (27 / 4 : ℝ) * (a ^ 2 * b ^ 3) := by ring
      _ = 8 := by rw [h₀] <;> norm_num
  have cube_eight : ∀ x : ℝ, x ^ 3 = 8 → x = 2 := by
    intro x hx
    have hprod : (x - 2) * ((x + 1) ^ 2 + 3) = 0 := by
      calc
        (x - 2) * ((x + 1) ^ 2 + 3) = x ^ 3 - 8 := by ring
        _ = 0 := sub_eq_zero.mpr hx
    have hpos : 0 < (x + 1) ^ 2 + 3 := by positivity
    exact sub_eq_zero.mp ((mul_eq_zero.mp hprod).resolve_right (ne_of_gt hpos))
  have ha_eq : a = 2 := cube_eight a ha_cube
  have hb_cube : (3 * b) ^ 3 = (8 : ℝ) := by
    calc
      (3 * b) ^ 3 = 27 * b ^ 3 := by ring
      _ = 8 := by nlinarith only [hmul, ha_eq]
  have hb_eq : 3 * b = 2 := cube_eight (3 * b) hb_cube
  linarith only [ha_eq, hb_eq]

#fva_audit mathd_algebra_362
