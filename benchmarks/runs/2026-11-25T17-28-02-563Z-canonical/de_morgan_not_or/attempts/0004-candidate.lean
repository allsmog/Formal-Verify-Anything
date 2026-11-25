import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.List.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem de_morgan_not_or (P Q : Prop) : ¬ (P ∨ Q) ↔ (¬ P ∧ ¬ Q) := by
  constructor
  ·
    intro
    fva_done "n1"
  ·
    fva_probe "n2"
