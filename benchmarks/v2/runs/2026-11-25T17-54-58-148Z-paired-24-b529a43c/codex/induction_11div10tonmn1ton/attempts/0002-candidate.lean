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

theorem induction_11div10tonmn1ton
  (n : ℕ) :
  11 ∣ (10^n - (-1 : ℤ)^n)  := by
  induction n with
  | zero =>
      simpa only [pow_zero, sub_self] using (dvd_zero (11 : ℤ))
  | succ n ih =>
      obtain ⟨k, hk⟩ := ih
      refine ⟨10 * k + (-1 : ℤ) ^ n, ?_⟩
      simp only [pow_succ]
      calc
        (10 : ℤ) ^ n * 10 - (-1 : ℤ) ^ n * (-1) =
            10 * ((10 : ℤ) ^ n - (-1 : ℤ) ^ n) + 11 * (-1 : ℤ) ^ n := by ring
        _ = _ := by rw [hk]; ring
  fva_done "n0"
