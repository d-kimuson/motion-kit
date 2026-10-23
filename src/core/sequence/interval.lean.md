<!-- Generated from interval.lean by scripts/lean-spec.ts. Do not edit. -->

# interval

## Definitions

- `Sequence.contains`: A sequence contains precisely the rational times in its half-open interval.
- `Sequence.localTime`: Local time is the signed offset from the sequence start, without rounding.

## Theorems

- `Sequence.membership`: Membership is inclusive at the start and exclusive at the end.
- `Sequence.adjacent_disjoint`: Intervals whose endpoints meet, [a, b) and [b, c), share no time.
- `Sequence.zero_length`: A zero-length sequence is empty at every time.
- `Sequence.start_included`: A nonempty sequence includes its start.
- `Sequence.end_excluded`: Every sequence excludes its end.
- `Sequence.local_time_zero`: Local time starts at zero.
- `Sequence.local_time_composition`: Nested sequence offsets compose without rounding their boundaries.
