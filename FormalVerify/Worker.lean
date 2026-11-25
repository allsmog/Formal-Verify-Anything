import Lean

/-!
The exploration worker keeps only an imported environment between requests.
Every request parses and elaborates the complete supplied source in a fresh
command state. This protocol is not a proof certificate: final admission uses
two independent command-line compiler invocations.
-/

open Lean

namespace FormalVerify.Worker

private def protocolVersion : Nat := 1

private abbrev ArtifactStamp := System.FilePath × Option (IO.FS.SystemTime × UInt64)

private structure ImportCache where
  key : String
  env : Environment
  artifacts : Array ArtifactStamp

private def object (fields : List (String × Json)) : Json := Json.mkObj fields

private def importKey (header : Elab.HeaderSyntax) : String :=
  (object [
    ("module", toJson header.isModule),
    ("imports", toJson <| header.imports.map fun i => object [
      ("module", toJson i.module.toString),
      ("all", toJson i.importAll),
      ("exported", toJson i.isExported),
      ("meta", toJson i.isMeta)])]).compress

private def field [FromJson α] (request : Json) (name : String) : IO α :=
  match request.getObjValAs? α name with
  | .ok value => pure value
  | .error message => throw <| IO.userError s!"invalid {name}: {message}"

private def emit (value : Json) : IO Unit := do
  let stdout ← IO.getStdout
  stdout.putStrLn value.compress
  stdout.flush

private def stampArtifact (file : System.FilePath) : IO ArtifactStamp := do
  let stamp ← if ← file.pathExists then do
    let metadata ← file.metadata
    pure <| some (metadata.modified, metadata.byteSize)
  else pure none
  return (file, stamp)

private def stampImports (env : Environment) : IO (Array ArtifactStamp) := do
  let mut stamps := #[]
  for name in env.header.moduleNames do
    let file ← findOLean name
    -- Include optional module-system parts and executable IR, including their
    -- absence: adding a previously absent part also invalidates the cache.
    for part in #[file, file.withExtension "olean.server", file.withExtension "olean.private",
        file.withExtension "ir"] do
      stamps := stamps.push (← stampArtifact part)
  return stamps

private def checkImports (cache : ImportCache) : IO Unit := do
  for (file, expected) in cache.artifacts do
    let (_, actual) ← stampArtifact file
    unless actual == expected do
      throw <| IO.userError s!"import artifact changed; worker restart required: {file}"

private def elaborate (request : Json) (cache : Option ImportCache)
    : IO (Json × Option ImportCache) := do
  let protocol : Nat ← field request "protocol"
  unless protocol == protocolVersion do
    throw <| IO.userError "unsupported worker protocol"
  let requestId : Nat ← field request "id"
  let source : String ← field request "source"
  let sourceFile : String ← field request "sourceFile"
  let maxOutputBytes : Nat ← field request "maxOutputBytes"
  let started ← IO.monoMsNow
  let inputCtx := Parser.mkInputContext source sourceFile
  let (header, parserState, headerMessages) ← Parser.parseHeader inputCtx
  let key := importKey header
  -- No asynchronous elaboration task may survive the lifetime of a request.
  let opts := Elab.async.set {} false
  let cached := cache.filter fun item => !headerMessages.hasErrors && item.key == key
  let cacheHit := cached.isSome
  let (env, messages, nextCache) ← if let some item := cached then
    checkImports item
    pure (item.env, headerMessages, cache)
  else
    -- As with the normal Lean CLI, installed imported artifacts are trusted.
    -- Every newly elaborated declaration still passes through Lean's kernel.
    let (env, messages) ← Elab.processHeader header opts headerMessages inputCtx
      (trustLevel := 1024)
      (mainModule := `FVAExploration)
    let nextCache ← if messages.hasErrors then pure none else do
      pure <| some { key, env, artifacts := ← stampImports env }
    pure (env, messages, nextCache)
  let imported ← IO.monoMsNow
  let messages ← if messages.hasErrors then pure messages else do
    let commandState := Elab.Command.mkState (env.setMainModule `FVAExploration) messages opts
    let state ← Elab.IO.processCommands inputCtx parserState commandState
    pure state.commandState.messages
  let finished ← IO.monoMsNow
  let mut output : Array Json := #[]
  let mut outputBytes := 0
  let mut truncated := false
  -- processCommands collects snapshot diagnostics into the unreported list.
  -- The reported lists are lookback histories and can contain duplicates.
  for message in messages.toArray do
    let json ← message.toJson
    let bytes := json.compress.utf8ByteSize + 1
    if outputBytes + bytes > maxOutputBytes then
      truncated := true
      break
    output := output.push json
    outputBytes := outputBytes + bytes
  return (object [
    ("type", toJson "result"),
    ("protocol", toJson protocolVersion),
    ("id", toJson requestId),
    ("exitCode", toJson <| if messages.hasErrors then (1 : Nat) else 0),
    ("messages", toJson output),
    ("truncated", toJson truncated),
    ("cacheHit", toJson cacheHit),
    ("artifactCount", toJson <| nextCache.map (·.artifacts.size) |>.getD 0),
    ("importMs", toJson (imported - started)),
    ("elaborationMs", toJson (finished - imported))], nextCache)

private partial def loop (cache : Option ImportCache := none) : IO Unit := do
  let line ← (← IO.getStdin).getLine
  if line.isEmpty then return
  let request ← match Json.parse line with
    | .ok request => pure request
    | .error message => throw <| IO.userError s!"invalid worker JSON: {message}"
  let (response, nextCache) ← elaborate request cache
  emit response
  loop nextCache

unsafe def run : IO UInt32 := do
  initSearchPath (← findSysroot)
  enableInitializersExecution
  emit <| object [
    ("type", toJson "ready"),
    ("protocol", toJson protocolVersion),
    ("leanVersion", toJson Lean.versionString)]
  try
    loop
    return 0
  catch error =>
    -- An internal/protocol failure cannot be confused with a Lean source error.
    emit <| object [
      ("type", toJson "fatal"),
      ("protocol", toJson protocolVersion),
      ("message", toJson error.toString)]
    return 2

end FormalVerify.Worker

unsafe def main : IO UInt32 := FormalVerify.Worker.run
