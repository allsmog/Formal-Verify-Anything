import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith.Frontend
import Mathlib.Tactic.Ring
import Mathlib.Data.List.Basic
import FormalVerify.Bridge

set_option maxHeartbeats 200000

theorem nat_add_comm (m n : Nat) : m + n = n + m := by
  simp_all
  fva_done "n0"
