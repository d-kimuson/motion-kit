import Std

namespace Sequence

/-- A sequence contains precisely the rational times in its half-open interval. -/
def contains (start finish time : Rat) : Bool := start ≤ time && time < finish

/-- Local time is the signed offset from the sequence start, without rounding. -/
def localTime (start time : Rat) : Rat := time - start

/-- Membership is inclusive at the start and exclusive at the end. -/
theorem membership (start finish time : Rat) :
    contains start finish time = true ↔ start ≤ time ∧ time < finish := by
  simp [contains]

/-- Adjacent sequences never contain the same time or sampled frame. -/
theorem adjacent_disjoint (a b c time : Rat) :
    ¬(contains a b time = true ∧ contains b c time = true) := by
  simp only [membership]; grind

/-- A zero-length sequence is empty at every time. -/
theorem zero_length (start time : Rat) : contains start start time = false := by
  simp [contains]; grind

/-- A nonempty sequence includes its start. -/
theorem start_included (start finish : Rat) (h : start < finish) :
    contains start finish start = true := by simp [contains, h]

/-- Every sequence excludes its end. -/
theorem end_excluded (start finish : Rat) : contains start finish finish = false := by
  simp [contains]

/-- Local time starts at zero. -/
theorem local_time_zero (start : Rat) : localTime start start = 0 := by
  simp only [localTime]; grind

/-- Nested sequence offsets compose without rounding their boundaries. -/
theorem local_time_composition (parent offset time : Rat) :
    localTime offset (localTime parent time) = localTime (parent + offset) time := by
  simp only [localTime]; grind

end Sequence
