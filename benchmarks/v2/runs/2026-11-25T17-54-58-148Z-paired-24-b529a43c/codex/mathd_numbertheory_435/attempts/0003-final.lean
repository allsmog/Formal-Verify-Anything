import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Data.Nat.GCD.Basic
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem mathd_numbertheory_435
  (k : ℕ)
  (h₀ : 0 < k)
  (h₁ : ∀ n, Nat.gcd (6 * n + k) (6 * n + 3) = 1)
  (h₂ : ∀ n, Nat.gcd (6 * n + k) (6 * n + 2) = 1)
  (h₃ : ∀ n, Nat.gcd (6 * n + k) (6 * n + 1) = 1) :
  5 ≤ k  := by
  have bad (d a b : Nat) (ha : d ∣ a) (hb : d ∣ b) (hd : ¬ d ∣ 1) : Nat.gcd a b ≠ 1 := by
    intro hg
    apply hd
    rw [← hg]
    exact Nat.dvd_gcd ha hb
  rcases k with _ | _ | _ | _ | _ | k
  · exact (Nat.lt_irrefl 0 h₀).elim
  · exact (bad 7 7 7 (by decide) (by decide) (by decide) (h₃ 1)).elim
  · exact (bad 2 2 2 (by decide) (by decide) (by decide) (h₂ 0)).elim
  · exact (bad 3 3 3 (by decide) (by decide) (by decide) (h₁ 0)).elim
  · exact (bad 2 4 2 (by decide) (by decide) (by decide) (h₂ 0)).elim
  · exact Nat.succ_le_succ (Nat.succ_le_succ (Nat.succ_le_succ (Nat.succ_le_succ (Nat.succ_le_succ (Nat.zero_le k)))))

#fva_audit mathd_numbertheory_435
