import Lean

/-!
Trusted observation bridge for Formal Verify Anything.

Exploration reports elaborator states and deliberately fails. It never assigns a
proof to an open goal. The driver must reject all errors other than its exact
probe-stop sentinel and must independently compile the completed standalone
proof before reporting success. Pretty-printed context is for proposal input;
proof search replays the original theorem instead of reparsing this context.
-/

open Lean Meta Elab Tactic Command

namespace FormalVerify

private def jstr (s : String) : Json := Json.str s

private def namesJson (names : Array Name) : Json :=
  Json.arr (names.map fun n => jstr n.toString)

private def exprText (e : Expr) : MetaM String := do
  return (← ppExpr (← instantiateMVars e)).pretty

private def exprHead (e : Expr) : String :=
  match e.consumeMData.getAppFn with
  | .const name _ => name.toString
  | .forallE .. => "forall"
  | .fvar .. => "fvar"
  | .mvar .. => "mvar"
  | .sort .. => "sort"
  | .lam .. => "lambda"
  | .letE .. => "let"
  | _ => "other"

private def binderKind : BinderInfo → String
  | .default => "explicit"
  | .implicit => "implicit"
  | .strictImplicit => "strict_implicit"
  | .instImplicit => "instance_implicit"

private def localDeclJson (decl : LocalDecl) : MetaM Json := do
  let type ← instantiateMVars decl.type
  let value ← match decl.value? with
    | some v => pure (jstr (← exprText v))
    | none => pure Json.null
  let mut dependencies := (collectFVars {} type).fvarIds
  if let some v := decl.value? then
    dependencies := (collectFVars { fvarIds := dependencies } (← instantiateMVars v)).fvarIds
  return Json.mkObj [
    ("id", jstr decl.fvarId.name.toString),
    ("name", jstr decl.userName.toString),
    ("type", jstr (← exprText type)),
    ("typeHead", jstr (exprHead type)),
    ("value", value),
    ("binder", jstr (binderKind decl.binderInfo)),
    ("isProp", Json.bool (← isProp type)),
    ("is_implementation_detail", Json.bool decl.isImplementationDetail),
    ("dependencies", Json.arr (dependencies.toList.eraseDups.toArray.map fun f => jstr f.name.toString)),
    ("has_metavariables", Json.bool type.hasMVar)
  ]

private def goalJson (goal : MVarId) : MetaM Json := goal.withContext do
  withOptions (fun opts => opts.setBool `pp.universes true |>.setBool `pp.fullNames true
      |>.setNat `pp.width 120) do
    let type ← instantiateMVars (← goal.getType)
    let mut declarations := #[]
    let mut required := collectFVars {} type
    for decl in (← getLCtx) do
      declarations := declarations.push decl
      if !decl.isImplementationDetail then
        required := required.add decl.fvarId
    -- Local declarations only depend on earlier declarations. A reverse pass
    -- closes the selected context over types and visible let values while
    -- excluding unrelated elaborator internals (notably self-bindings).
    for decl in declarations.reverse do
      if required.fvarSet.contains decl.fvarId then
        required := collectFVars required (← instantiateMVars decl.type)
        if let some value := decl.value? then
          required := collectFVars required (← instantiateMVars value)
    let mut hypotheses := #[]
    let mut universes := collectLevelParams {} type
    for decl in declarations do
      if required.fvarSet.contains decl.fvarId then
        hypotheses := hypotheses.push (← localDeclJson decl)
        universes := collectLevelParams universes (← instantiateMVars decl.type)
        if let some value := decl.value? then
          universes := collectLevelParams universes (← instantiateMVars value)
    let targetArgs ← type.getAppArgs.mapM fun arg => do
      pure (jstr (← exprText arg))
    return Json.mkObj [
      ("id", jstr goal.name.toString),
      ("target", jstr (← exprText type)),
      ("targetHead", jstr (exprHead type)),
      ("targetArgs", Json.arr targetArgs),
      ("hypotheses", Json.arr hypotheses),
      ("omitted_implementation_details", toJson (declarations.size - hypotheses.size)),
      ("universe_parameters", namesJson universes.params),
      ("has_metavariables", Json.bool type.hasMVar),
      ("pretty", jstr (← Meta.ppGoal goal).pretty)
    ]

private def probe (nodeId : String) : TacticM Unit := do
  let goals ← getUnsolvedGoals
  let states ← goals.toArray.mapM fun goal => do
    let state ← goalJson goal
    pure state
  let payload := Json.mkObj [
    ("version", toJson (1 : Nat)),
    ("node_id", jstr nodeId),
    ("goals", Json.arr states)
  ]
  logInfo m!"FVA_STATE:{payload.compress}"
  if goals.isEmpty then
    let closed := Json.mkObj [("node_id", jstr nodeId)]
    logInfo m!"FVA_CLOSED:{closed.compress}"
  throwError "FVA_PROBE_STOP:{nodeId}"

/-- Observe open goals and stop elaboration without filling them. -/
elab "fva_probe " nodeId:str : tactic => probe nodeId.getString

/-- Also callable after a closing tactic; emits `FVA_CLOSED` for zero goals. -/
elab "fva_done " nodeId:str : tactic => probe nodeId.getString

private def allowedAxiom (name : Name) : Bool :=
  name == `propext || name == `Classical.choice || name == `Quot.sound

/-- Check the kernel's theorem declaration and its transitive axiom closure. -/
elab "#fva_audit " declaration:ident : command => do
  let name ← liftCoreM <| realizeGlobalConstNoOverloadWithInfo declaration
  let env ← getEnv
  let some info := env.checked.get.find? name
    | throwError "FVA_AUDIT_REJECTED: declaration is absent from the checked environment"
  let .thmInfo theoremInfo := info
    | throwError "FVA_AUDIT_REJECTED: expected a theorem declaration"
  if theoremInfo.value.hasMVar || theoremInfo.value.hasFVar then
    throwError "FVA_AUDIT_REJECTED: theorem contains unresolved variables"
  let axioms := (← collectAxioms name).qsort Name.lt
  let rejected := axioms.filter fun ax => !allowedAxiom ax
  unless rejected.isEmpty do
    throwError "FVA_AUDIT_REJECTED: unapproved dependencies {rejected.toList}"
  let typeText ← liftTermElabM do
    unless (← isProp theoremInfo.type) do
      throwError "FVA_AUDIT_REJECTED: expected a proposition"
    withOptions (fun opts => opts.setBool `pp.universes true |>.setBool `pp.fullNames true) do
      exprText theoremInfo.type
  let payload := Json.mkObj [
    ("version", toJson (1 : Nat)),
    ("declaration", jstr name.toString),
    ("kind", jstr "theorem"),
    ("kernel_checked", Json.bool true),
    ("passed", Json.bool true),
    ("axioms", namesJson axioms),
    ("type", jstr typeText),
    ("universe_parameters", namesJson theoremInfo.levelParams.toArray)
  ]
  logInfo m!"FVA_AUDIT:{payload.compress}"

end FormalVerify
