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
    norm_num [hz] at h₀
  have hmul : a = (27 / 4 : ℝ) * b ^ 3 := (div_eq_iff hb_ne).mp h₁
  have ha_cube : a ^ 3 = (8 : ℝ) := by
    have h := congrArg (fun x : ℝ => a ^ 2 * x) hmul
    dsimp at h
    nlinarith only [h, h₀]
  have ha_prod : (a - 2) * ((a + 1) ^ 2 + 3) = 0 := by
    nlinarith only [ha_cube]
  have ha_eq : a = 2 := by
    rcases mul_eq_zero.mp ha_prod with hz | hz
    · exact sub_eq_zero.mp hz
    · nlinarith only [hz, sq_nonneg (a + 1)]
  have hb_cube : b ^ 3 = (8 / 27 : ℝ) := by
    nlinarith only [ha_eq, hmul]
  have hb_prod : (b - 2 / 3) * ((b + 1 / 3) ^ 2 + 1 / 3) = 0 := by
    nlinarith only [hb_cube]
  rcases mul_eq_zero.mp hb_prod with hz | hz
  · linarith only [ha_eq, hz]
  · nlinarith only [hz, sq_nonneg (b + 1 / 3)]

#fva_audit mathd_algebra_362
