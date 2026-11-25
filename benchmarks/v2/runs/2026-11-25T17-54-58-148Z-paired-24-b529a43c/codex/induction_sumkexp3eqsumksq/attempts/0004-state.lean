import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.GCongr
import Mathlib.Data.Real.Basic
import Mathlib.Topology.Defs.Induced
import Mathlib.Algebra.BigOperators.Group.Finset.Defs
import Mathlib.Algebra.BigOperators.Intervals
import FormalVerify.Bridge

open BigOperators Real Nat Topology Rat
set_option maxHeartbeats 200000

theorem induction_sumkexp3eqsumksq
  (n : ℕ) :
  ∑ k ∈ Finset.range n, k^3 = (∑ k ∈ Finset.range n, k)^2  := by
  have hsum : ∀ m : Nat, 2 * (Finset.range m).sum (fun k => k) + m = m ^ 2 := by
    intro m
    induction m with
    | zero => simp
    | succ m ih =>
      rw [Finset.sum_range_succ]
      calc
        2 * ((Finset.range m).sum (fun k => k) + m) + (m + 1) =
            (2 * (Finset.range m).sum (fun k => k) + m) + (2 * m + 1) := by ring
        _ = (m + 1) ^ 2 := by rw [ih]; ring
  fva_probe "n2"
