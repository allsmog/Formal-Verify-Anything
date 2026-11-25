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

theorem induction_12dvd4expnp1p20
  (n : ℕ) :
  12 ∣ 4^(n+1) + 20  := by
  simp_all
  ·
    ring
    ·
      induction n
      fva_done "n2"
