import Std

namespace Timeline

/-- Presentation time for a signed frame at a rational frames-per-second rate. -/
def frameToTime (frame : Int) (fps : Rat) : Rat := frame / fps

/-- The unrounded frame position preserves fractional frame boundaries. -/
def framePosition (time fps : Rat) : Rat := time * fps

/-- The default conversion selects the frame at or immediately before the time. -/
def timeToFrameFloor (time fps : Rat) : Int := (framePosition time fps).floor

/-- Explicit ceiling conversion selects the frame at or immediately after the time. -/
def timeToFrameCeil (time fps : Rat) : Int := -((-framePosition time fps).floor)

/-- Explicit nearest conversion breaks half-frame ties toward positive infinity. -/
def timeToFrameNearest (time fps : Rat) : Int := (framePosition time fps + 1 / 2).floor

/-- The number of output samples in a nonnegative duration is its ceiling frame position. -/
def frameCount (duration fps : Rat) : Int := timeToFrameCeil duration fps

/-- Output frame validation accepts exactly the half-open integer range. -/
def validFrame (total frame : Int) : Bool := 0 ≤ frame && frame < total

/-- Converting an integer frame to time and back preserves signed frame identity. -/
theorem frame_roundtrip (frame : Int) (fps : Rat) (h : fps ≠ 0) :
    timeToFrameFloor (frameToTime frame fps) fps = frame := by
  simp [timeToFrameFloor, framePosition, frameToTime, Rat.div_mul_cancel h, Rat.floor_intCast]

/-- Exact frame boundaries also round-trip through the explicit ceiling conversion. -/
theorem frame_count_roundtrip (frame : Int) (fps : Rat) (h : fps ≠ 0) :
    frameCount (frameToTime frame fps) fps = frame := by
  simp [frameCount, timeToFrameCeil, framePosition, frameToTime, Rat.div_mul_cancel h,
    ← Rat.intCast_neg, Rat.floor_intCast]

/-- The default frame conversion is monotonic for positive frame rates. -/
theorem floor_monotonic (a b fps : Rat) (h : a ≤ b) (hf : 0 < fps) :
    timeToFrameFloor a fps ≤ timeToFrameFloor b fps := by
  apply Rat.floor_monotone
  exact Rat.mul_le_mul_of_nonneg_right h (Rat.le_of_lt hf)

/-- Floor contains the exact position between its selected frame and the next frame. -/
theorem floor_bounds (time fps : Rat) :
    (timeToFrameFloor time fps : Rat) ≤ framePosition time fps ∧
    framePosition time fps < ((timeToFrameFloor time fps + 1 : Int) : Rat) := by
  exact ⟨Rat.floor_le _, Rat.lt_floor_add_one _⟩

/-- Ceiling is the least integer at or above the exact frame position. -/
theorem ceil_bounds (time fps : Rat) :
    framePosition time fps ≤ (timeToFrameCeil time fps : Rat) ∧
    ((timeToFrameCeil time fps - 1 : Int) : Rat) < framePosition time fps := by
  have h₁ := Rat.floor_le (-framePosition time fps)
  have h₂ := Rat.lt_floor_add_one (-framePosition time fps)
  simp only [timeToFrameCeil]
  constructor <;> grind

/-- The last sample before the ceiling count is before the duration; the next sample is not. -/
theorem sampling_bounds (duration fps : Rat) (hf : 0 < fps) :
    frameToTime (frameCount duration fps - 1) fps < duration ∧
    duration ≤ frameToTime (frameCount duration fps) fps := by
  have h := ceil_bounds duration fps
  constructor
  · exact (Rat.div_lt_iff hf).mpr h.2
  · apply Rat.not_lt.mp
    intro hlt
    have hbad := (Rat.div_lt_iff hf).mp hlt
    unfold frameCount at hbad
    unfold framePosition at h
    grind

/-- Nearest rounding selects the integer within a half-frame, with the upper threshold excluded. -/
theorem nearest_bounds (time fps : Rat) :
    (timeToFrameNearest time fps : Rat) - 1 / 2 ≤ framePosition time fps ∧
    framePosition time fps < (timeToFrameNearest time fps : Rat) + 1 / 2 := by
  have h₁ := Rat.floor_le (framePosition time fps + 1 / 2)
  have h₂ := Rat.lt_floor_add_one (framePosition time fps + 1 / 2)
  unfold timeToFrameNearest
  grind

/-- Nearest rounding sends every signed half-frame tie to the greater integer. -/
theorem nearest_tie (n : Int) : timeToFrameNearest ((n : Rat) + 1 / 2) 1 = n + 1 := by
  have h : (n : Rat) + 1 / 2 + 1 / 2 = (n + 1 : Int) := by grind
  simpa [timeToFrameNearest, framePosition, h] using Rat.floor_intCast (n + 1)

/-- A zero duration contains no output samples. -/
theorem frame_count_zero (fps : Rat) : frameCount 0 fps = 0 := by
  simp [frameCount, timeToFrameCeil, framePosition, Rat.floor]

/-- The last frame of a nonempty timeline is valid. -/
theorem last_frame (total : Int) (h : 0 < total) : validFrame total (total - 1) = true := by
  simp [validFrame]; omega

/-- The frame at the exclusive end is invalid, including an empty timeline. -/
theorem frame_past_end (total : Int) : validFrame total total = false := by
  simp [validFrame]

/-- Negative output frames are invalid even though mathematical conversions are signed. -/
theorem negative_frame (total frame : Int) (h : frame < 0) : validFrame total frame = false := by
  simp [validFrame]; omega

end Timeline
