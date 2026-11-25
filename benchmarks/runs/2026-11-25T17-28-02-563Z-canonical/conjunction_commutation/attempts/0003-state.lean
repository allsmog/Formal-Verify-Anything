import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.List.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem conjunction_commutation (P Q : Prop) (h : P ∧ Q) : Q ∧ P := by
  constructor
  ·
    fva_probe "n1"
  ·
    fva_probe "n2"
