import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.List.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem list_reverse_involution {α : Type} (xs : List α) : xs.reverse.reverse = xs := by
  fva_probe "n0"
