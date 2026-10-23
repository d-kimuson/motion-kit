<!-- Generated from overlap.lean by scripts/lean-spec.ts. Do not edit. -->

# overlap

## Definitions

- `Transition.validOverlap`: An overlap may equal either adjacent scene, but cannot exceed it or be negative.
- `Transition.nextStart`: The incoming scene starts before the outgoing scene ends by exactly the overlap.
- `Transition.pairDuration`: The combined duration subtracts the shared overlap once.
- `Transition.totalDuration`: Series duration is the exact sum of scenes minus the exact sum of overlaps.
- `Transition.layout`: Place scenes recursively from an exact offset, subtracting the next overlap at each step.
  Missing overlaps are zero; public input validation requires exactly one per adjacent pair.
- `Transition.placementEnd`: Accumulating scene placement returns the exclusive end of the final scene.
- `Transition.progress`: Progress is clamped to zero before the overlap and one at its exclusive end.
  A zero overlap switches directly from zero to one at its start.

## Theorems

- `Transition.placement_total`: For one overlap per adjacent pair, accumulated placement equals the sum-minus-overlaps rule.
- `Transition.layout_empty`: An empty series places no scene, regardless of its offset.
- `Transition.layout_head`: Each placed scene starts at the exact current offset and ends one duration later.
- `Transition.layout_entry`: Entry i starts at the initial offset plus the durations before i minus the overlaps before i,
  and ends one scene duration later. This holds for all rational lists, hence in particular for
  validated nonnegative durations with exactly one bounded overlap per adjacent pair.
- `Transition.layout_adjacent`: At every adjacent pair of layout entries, the incoming start is the outgoing end minus
  that pair's overlap. Both ends are their respective starts plus their scene durations.
- `Transition.layout_three_scenes`: Three ten-unit scenes with overlaps two and three occupy [0,10), [8,18), [15,25).
- `Transition.overlap_bounds`: Valid overlap is exactly the nonnegative value bounded by both adjacent scenes.
- `Transition.overlap_membership`: Both scenes are present throughout their overlap, including its start.
- `Transition.overlap_membership_offset`: At any layout offset, both adjacent scenes contain every time in their overlap.
- `Transition.layout_overlap_membership`: Every adjacent pair actually returned by layout contains every time in its half-open
  overlap, at any index and initial offset, provided that pair's overlap is valid.
- `Transition.zero_overlap`: Zero overlap has no time at which both adjacent scenes are present.
- `Transition.overlap_equal_scene`: Overlap equal to the outgoing scene starts the incoming scene at zero.
- `Transition.full_overlap_duration`: Subtracting a full outgoing scene overlap leaves exactly the incoming duration.
- `Transition.empty_series`: An empty series has zero duration.
- `Transition.total_duration`: Adding a scene and its overlap increases duration by their difference.
- `Transition.progress_before`: Progress is zero at every time strictly before the overlap starts.
- `Transition.progress_after`: A nonnegative overlap has progress one at every time at or after its exclusive end.
- `Transition.progress_start`: A positive overlap has zero progress at its start.
- `Transition.progress_end`: Progress is one at the exclusive end, including zero-length overlaps.
