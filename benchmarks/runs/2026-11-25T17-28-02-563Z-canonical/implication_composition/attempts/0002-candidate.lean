import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.List.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem implication_composition (P Q R : Prop) (hPQ : P → Q) (hQR : Q → R) : P → R := by
  intro
  fva_done "n0"
