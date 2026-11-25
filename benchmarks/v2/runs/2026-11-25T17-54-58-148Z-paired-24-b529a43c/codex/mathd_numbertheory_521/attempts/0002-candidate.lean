import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Algebra.Ring.Parity
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem mathd_numbertheory_521
  (m n : ℕ)
  (h₀ : Even m)
  (h₁ : Even n)
  (h₂ : m - n = 2)
  (h₃ : m * n = 288) :
  m = 18  := by
  rcases lt_trichotomy m 18 with hm | hm | hm
  · have hp : m * n ≤ 17 * 16 := Nat.mul_le_mul (by omega) (by omega)
    rw [h₃] at hp
    norm_num at hp
  · exact hm
  · have hp : 19 * 16 ≤ m * n := Nat.mul_le_mul (by omega) (by omega)
    rw [h₃] at hp
    norm_num at hp
  fva_done "n0"
