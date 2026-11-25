import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Data.Nat.Factorial.Basic
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem induction_nfactltnexpnm1ngt3
  (n : ℕ)
  (h₀ : 3 ≤ n) :
  (n)! < n^(n - 1)  := by
  have factorial_bound : ∀ k m : Nat, k + 2 ≤ m → (k + 2).factorial ≤ 2 * m ^ k := by
    intro k
    induction k with
    | zero =>
        intro m hm
        change Nat.factorial 2 ≤ 2 * m ^ 0
        rw [pow_zero, Nat.mul_one] <;> decide
    | succ k ih =>
        intro m hm
        have hsmall : k + 2 ≤ m := Nat.le_trans (Nat.le_succ (k + 2)) hm
        change Nat.factorial (k + 2 + 1) ≤ 2 * m ^ (k + 1)
        rw [Nat.factorial_succ, pow_succ]
        calc
          (k + 2 + 1) * Nat.factorial (k + 2) ≤ m * (2 * m ^ k) :=
            Nat.mul_le_mul hm (ih m hsmall)
          _ = 2 * (m ^ k * m) := by ac_rfl
  fva_probe "n2"
