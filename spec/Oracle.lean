import Lean.Data.Json
import src.core.timeline.time
import src.core.sequence.interval
import src.core.transition.overlap

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

structure RationalInput where
  numerator : Int
  denominator : Nat
  deriving FromJson, ToJson

def RationalInput.value (input : RationalInput) : Rat :=
  mkRat input.numerator input.denominator

def readRat (args : Json) (key : String) : Except String Rat := do
  let value ← args.getObjValAs? RationalInput key
  if value.denominator == 0 then throw "denominator must be positive"
  return value.value

def ratJson (value : Rat) : Json := Json.mkObj [
  ("numerator", toJson (toString value.num)), ("denominator", toJson (toString value.den))]

def evalCase (input : Json) : Except String Json := do
  let args ← input.getObjVal? "args"
  match ← input.getObjValAs? String "fn" with
  | "Timeline.sample" =>
    let time ← readRat args "time"
    let duration ← readRat args "duration"
    let fps ← readRat args "fps"
    let frame ← args.getObjValAs? Int "frame"
    let total ← args.getObjValAs? Int "total"
    return Json.mkObj [
      ("time", ratJson (Timeline.frameToTime frame fps)),
      ("position", ratJson (Timeline.framePosition time fps)),
      ("floor", toJson (toString (Timeline.timeToFrameFloor time fps))),
      ("ceil", toJson (toString (Timeline.timeToFrameCeil time fps))),
      ("nearest", toJson (toString (Timeline.timeToFrameNearest time fps))),
      ("count", toJson (toString (Timeline.frameCount duration fps))),
      ("valid", toJson (Timeline.validFrame total frame))]
  | "Sequence.sample" =>
    let start ← readRat args "start"
    let finish ← readRat args "end"
    let time ← readRat args "time"
    return Json.mkObj [
      ("contains", toJson (Sequence.contains start finish time)),
      ("localTime", ratJson (Sequence.localTime start time))]
  | "Transition.sample" =>
    let left ← readRat args "left"
    let right ← readRat args "right"
    let overlap ← readRat args "overlap"
    let time ← readRat args "time"
    let start := Transition.nextStart left overlap
    return Json.mkObj [
      ("valid", toJson (Transition.validOverlap left right overlap)),
      ("start", ratJson start),
      ("duration", ratJson (Transition.pairDuration left right overlap)),
      ("active", toJson (Sequence.contains start left time)),
      ("progress", ratJson (Transition.progress start overlap time))]
  | "Transition.layout" =>
    let scenes ← args.getObjValAs? (List RationalInput) "scenes"
    let overlaps ← args.getObjValAs? (List RationalInput) "overlaps"
    return toJson ((Transition.layout 0 (scenes.map RationalInput.value)
      (overlaps.map RationalInput.value)).map fun (start, finish) =>
        Json.mkObj [("start", ratJson start), ("end", ratJson finish)])
  | "Transition.totalDuration" =>
    let scenes ← args.getObjValAs? (List RationalInput) "scenes"
    let overlaps ← args.getObjValAs? (List RationalInput) "overlaps"
    return ratJson (Transition.totalDuration (scenes.map RationalInput.value)
      (overlaps.map RationalInput.value))
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
