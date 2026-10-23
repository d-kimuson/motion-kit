<!-- Generated from time.lean by scripts/lean-spec.ts. Do not edit. -->

# time

## Definitions

- `Timeline.frameToTime`: Presentation time for a signed frame at a rational frames-per-second rate.
- `Timeline.framePosition`: The unrounded frame position preserves fractional frame boundaries.
- `Timeline.timeToFrameFloor`: The default conversion selects the frame at or immediately before the time.
- `Timeline.timeToFrameCeil`: Explicit ceiling conversion selects the frame at or immediately after the time.
- `Timeline.timeToFrameNearest`: Explicit nearest conversion breaks half-frame ties toward positive infinity.
- `Timeline.frameCount`: The number of output samples in a nonnegative duration is its ceiling frame position.
- `Timeline.validFrame`: Output frame validation accepts exactly the half-open integer range.

## Theorems

- `Timeline.frame_roundtrip`: Converting an integer frame to time and back preserves signed frame identity.
- `Timeline.frame_count_roundtrip`: Exact frame boundaries also round-trip through the explicit ceiling conversion.
- `Timeline.floor_monotonic`: The default frame conversion is monotonic for positive frame rates.
- `Timeline.floor_bounds`: Floor contains the exact position between its selected frame and the next frame.
- `Timeline.ceil_bounds`: Ceiling is the least integer at or above the exact frame position.
- `Timeline.sampling_bounds`: The last sample before the ceiling count is before the duration; the next sample is not.
- `Timeline.nearest_bounds`: Nearest rounding selects the integer within a half-frame, with the upper threshold excluded.
- `Timeline.nearest_tie`: Nearest rounding sends every signed half-frame tie to the greater integer.
- `Timeline.frame_count_zero`: A zero duration contains no output samples.
- `Timeline.last_frame`: The last frame of a nonempty timeline is valid.
- `Timeline.frame_past_end`: The frame at the exclusive end is invalid, including an empty timeline.
- `Timeline.negative_frame`: Negative output frames are invalid even though mathematical conversions are signed.
