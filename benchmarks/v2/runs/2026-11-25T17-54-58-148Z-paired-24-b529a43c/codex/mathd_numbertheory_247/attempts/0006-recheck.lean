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
  have check : ∀ r : Fin 11, (3 * r.val) % 11 = 2 → r.val = 8 := by decide
  apply check ⟨n % 11, Nat.mod_lt n (by decide)⟩
  change (3 * (n % 11)) % 11 = 2
  rw [Nat.mul_mod] at h₀
  exact h₀

#fva_audit mathd_numbertheory_247
