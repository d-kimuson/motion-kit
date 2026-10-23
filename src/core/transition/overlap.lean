import src.core.sequence.interval

namespace Transition

/-- An overlap may equal either adjacent scene, but cannot exceed it or be negative. -/
def validOverlap (left right overlap : Rat) : Bool :=
  0 ≤ overlap && overlap ≤ left && overlap ≤ right

/-- The incoming scene starts before the outgoing scene ends by exactly the overlap. -/
def nextStart (left overlap : Rat) : Rat := left - overlap

/-- The combined duration subtracts the shared overlap once. -/
def pairDuration (left right overlap : Rat) : Rat := left + right - overlap

/-- Series duration is the exact sum of scenes minus the exact sum of overlaps. -/
def totalDuration (scenes overlaps : List Rat) : Rat := scenes.sum - overlaps.sum

/-- Place scenes recursively from an exact offset, subtracting the next overlap at each step.
Missing overlaps are zero; public input validation requires exactly one per adjacent pair. -/
def layout (start : Rat) (scenes overlaps : List Rat) : List (Rat × Rat) :=
  match scenes with
  | [] => []
  | scene :: rest => (start, start + scene) ::
      layout (start + scene - overlaps.headD 0) rest (overlaps.drop 1)

/-- Accumulating scene placement returns the exclusive end of the final scene. -/
def placementEnd (start : Rat) (scenes overlaps : List Rat) : Rat :=
  match scenes with
  | [] => start
  | [scene] => start + scene
  | scene :: next :: rest =>
      placementEnd (start + scene - overlaps.headD 0) (next :: rest) (overlaps.drop 1)

/-- For one overlap per adjacent pair, accumulated placement equals the sum-minus-overlaps rule. -/
theorem placement_total (start : Rat) (scenes overlaps : List Rat)
    (h : overlaps.length = scenes.length - 1) :
    placementEnd start scenes overlaps = start + totalDuration scenes overlaps := by
  induction scenes generalizing start overlaps with
  | nil =>
    have he : overlaps = [] := List.length_eq_zero_iff.mp (by simpa using h)
    subst overlaps
    simp only [placementEnd, totalDuration, List.sum_nil]
    grind
  | cons scene rest ih =>
    cases rest with
    | nil =>
      have he : overlaps = [] := List.length_eq_zero_iff.mp (by simpa using h)
      subst overlaps
      simp only [placementEnd, totalDuration, List.sum_cons, List.sum_nil]
      grind
    | cons next rest =>
      cases overlaps with
      | nil => simp at h
      | cons overlap remaining =>
        have hl : remaining.length = (next :: rest).length - 1 := by simpa using h
        simp only [placementEnd, List.headD_cons, List.drop_succ_cons, List.drop_zero]
        rw [ih _ _ hl]
        simp only [totalDuration, List.sum_cons]
        grind

/-- An empty series places no scene, regardless of its offset. -/
theorem layout_empty (start : Rat) : layout start [] [] = [] := by rfl

/-- Each placed scene starts at the exact current offset and ends one duration later. -/
theorem layout_head (start scene : Rat) (rest overlaps : List Rat) :
    (layout start (scene :: rest) overlaps).head? = some (start, start + scene) := by rfl

/-- Progress is clamped to zero before the overlap and one at its exclusive end.
A zero overlap switches directly from zero to one at its start. -/
def progress (start duration time : Rat) : Rat :=
  if time < start then 0 else if start + duration ≤ time then 1 else (time - start) / duration

/-- Valid overlap is exactly the nonnegative value bounded by both adjacent scenes. -/
theorem overlap_bounds (left right overlap : Rat) :
    validOverlap left right overlap = true ↔ 0 ≤ overlap ∧ overlap ≤ left ∧ overlap ≤ right := by
  simp [validOverlap, and_assoc]

/-- Both scenes are present throughout their overlap, including its start. -/
theorem overlap_membership (left right overlap time : Rat)
    (h : validOverlap left right overlap = true)
    (ht : Sequence.contains (nextStart left overlap) left time = true) :
    Sequence.contains 0 left time = true ∧
    Sequence.contains (nextStart left overlap) (pairDuration left right overlap) time = true := by
  simp only [overlap_bounds] at h
  simp only [Sequence.membership, nextStart, pairDuration] at ht ⊢
  grind

/-- Zero overlap has no time at which both adjacent scenes are present. -/
theorem zero_overlap (left time : Rat) :
    Sequence.contains (nextStart left 0) left time = false := by
  have h : nextStart left 0 = left := by unfold nextStart; grind
  rw [h]; exact Sequence.zero_length left time

/-- Overlap equal to the outgoing scene starts the incoming scene at zero. -/
theorem overlap_equal_scene (left : Rat) : nextStart left left = 0 := by
  simp only [nextStart]; grind

/-- Subtracting a full outgoing scene overlap leaves exactly the incoming duration. -/
theorem full_overlap_duration (left right : Rat) : pairDuration left right left = right := by
  simp only [pairDuration]; grind

/-- An empty series has zero duration. -/
theorem empty_series : totalDuration [] [] = 0 := by
  simp only [totalDuration, List.sum_nil]; grind

/-- Adding a scene and its overlap increases duration by their difference. -/
theorem total_duration (scenes overlaps : List Rat) (scene overlap : Rat) :
    totalDuration (scene :: scenes) (overlap :: overlaps) =
    totalDuration scenes overlaps + scene - overlap := by
  simp only [totalDuration, List.sum_cons]; grind

/-- A positive overlap has zero progress at its start. -/
theorem progress_start (start duration : Rat) (h : 0 < duration) :
    progress start duration start = 0 := by
  simp [progress, show ¬start + duration ≤ start by grind, Rat.sub_self, Rat.div_def]

/-- Progress is one at the exclusive end, including zero-length overlaps. -/
theorem progress_end (start duration : Rat) (h : 0 ≤ duration) :
    progress start duration (start + duration) = 1 := by
  simp [progress, show ¬start + duration < start by grind]

end Transition
