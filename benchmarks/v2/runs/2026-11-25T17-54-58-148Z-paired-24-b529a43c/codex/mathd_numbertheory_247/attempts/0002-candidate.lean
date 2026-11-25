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

theorem mathd_numbertheory_247
  (n : ℕ)
  (h₀ : (3 * n) % 11 = 2) :
  n % 11 = 8  := by
  calc
    n % 11 = (12 * n) % 11 := by
      rw [Nat.mul_mod]
      change n % 11 = (1 * (n % 11)) % 11
      rw [one_mul, Nat.mod_mod]
    _ = 8 := by
      change (4 * 3 * n) % 11 = 8
      rw [Nat.mul_assoc, Nat.mul_mod, h₀] <;> decide
  fva_done "n0"
