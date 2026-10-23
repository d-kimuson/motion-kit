import Lean.Data.Json

open Lean

/-
Evaluates the spec's definitions for differential tests. Reads one JSON object per line from stdin,
`{"fn": <name>, "args": <arguments>}`, and writes the result as one line of JSON, or `{"error": <message>}`.

To make a definition testable, import its module, derive FromJson/ToJson for the types it takes and returns,
and add a case. For example, for `Timeline.clampFrame (total frame : Nat) : Nat` in src/core/timeline/clamp-frame.lean:

  import src.core.timeline.«clamp-frame»
  | "Timeline.clampFrame" =>
    let args ← input.getObjVal? "args"
    return toJson (Timeline.clampFrame (← args.getObjValAs? Nat "total") (← args.getObjValAs? Nat "frame"))

A structure argument is read with `fromJson?` after `deriving instance FromJson, ToJson for <Type>`.
-/

def evalCase (input : Json) : Except String Json := do
  match ← input.getObjValAs? String "fn" with
  | name => throw s!"unknown function: {name}"

def main : IO Unit := do
  let stdin ← IO.getStdin
  let stdout ← IO.getStdout
  repeat
    let line ← stdin.getLine
    if line.isEmpty then break
    match Json.parse line >>= evalCase with
    | .ok output => stdout.putStrLn output.compress
    | .error message => stdout.putStrLn (Json.mkObj [("error", message)]).compress
    stdout.flush
