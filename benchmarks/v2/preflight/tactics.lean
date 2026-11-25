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

example (n : Nat) : n = n := by omega
example : (1 : ℚ) + 1 = 2 := by norm_num
example (x : ℝ) : (x + 1)^2 = x^2 + 2*x + 1 := by ring
example (x : ℝ) (h : x = 0) : x = 0 := by linarith
example (x : ℝ) : x*x ≥ 0 := by nlinarith [sq_nonneg x]
example (P : Prop) (h : P) : P := by aesop
example (P : Prop) (h : P) : P := by simp_all
example (n : Nat) : 0 ≤ n := by positivity
example (x : ℝ) (h : x ≠ 0) : x / x = 1 := by field_simp at *
example (x : ℝ) : x + x = 2*x := by ring_nf at *
example (n : Nat) : (n : ℤ) = (n : ℤ) := by norm_cast at *
example (m n : Nat) (h : (m : ℤ) = (n : ℤ)) : m = n := by exact_mod_cast h
example (a b : ℝ) (h : a ≤ b) : a + 1 ≤ b + 1 := by gcongr
