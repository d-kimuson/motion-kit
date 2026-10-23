# Evaluate Pure Motion with explicit numeric inputs and Result failures

## Context

TASK-152 implements `interpolate`, `keyframes` and `easing` without React, the clock or the Time Module. These are Tier A values, not a rendered integration guarantee; see the [Phase 0 decision](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#seekability-boundary).

The user-owned design.md §6.2 lists these APIs and shows `[0, 0.6]` to `[0, 1]` with `clamp` and `easeOutCubic`. It does not specify extrapolation semantics, defaults or the keyframe shape. Its direct assignment of `interpolate(...)` to opacity predates the task's required Result contract. This decision fixes those gaps; it does not claim they were already specified there.

## Decision

- `interpolate(input, inputRange, outputRange, options)` returns the shared `Result<number>` from `src/lib/result.ts`, whose failure payload is `Diagnostic`. Both ranges have the same length, at least two entries, and finite values. Input stops are strictly ascending; output stops may increase, decrease or repeat. Input is finite.
- `keyframes(time, frames, options)` accepts readonly `{ time: number; value: number }` stops with the same validation. Times are plain seconds, not Time Module values. It uses the same interpolation rules, including on two stops. Options apply to every segment.
- Defaults are `extrapolate: 'clamp'` and `easing.linear`. Easing receives normalized segment progress, clamped to `[0, 1]`. Exact stops return their output values for endpoint-preserving easings.
- `clamp` holds the outer endpoint outside the whole input range. It clamps progress, **not** the eased output: Back or Bézier overshoot inside the range remains visible.
- `extend` continues the raw first/last segment slope outside the whole input range. With segment progress `p`, clamped progress `c`, and eased output `base`, return `base + (p - c) * (to - from)`. Easing is never called outside `[0, 1]`.
- `identity` returns the original input unchanged only outside the whole input range. Inside it uses the same segment easing as the other modes.
- `Easing = (progress: number) => number`. Custom easings must be stateless, finite and preserve 0 and 1; throwing or history-dependent callbacks violate that caller contract. Built-in direct calls clamp finite progress outside `[0, 1]` and return exact endpoints. Standard cubic, exponential and Back in/out/in-out formulas are provided; Back uses overshoot constants `1.70158` and `1.70158 * 1.525` for in-out.
- `easing.cubicBezier(x1, y1, x2, y2)` returns the shared `Result<Easing>`. All controls are finite, x controls are in `[0, 1]`, and y controls are unrestricted. CSS curve semantics invert the monotonic x coordinate before evaluating y; x1 need not be less than x2. Direct calls clamp outside progress, rather than implementing CSS tangent extension.
- Invalid input returns `motion.invalid-input`. A non-finite easing result or an evaluated output outside the finite number range returns `motion.non-finite-result`; intermediate overflow alone must not reject a representable output. Neither failure is thrown or silently saturated. Both codes have error severity and actionable hints, without a details payload.

## Consequences

Callers branch on `ok` and use `value` or `error`; the design.md opacity example needs that adaptation. Numeric overflow is an explicit failure instead of poisoning later styles with NaN/Infinity. Endpoint-preserving custom easings remain the caller's responsibility; returned non-finite numbers are diagnosed, but thrown programmer errors are not caught.

`src/motion/index.ts` exports the source API and its types. Package exports remain only `.` and `./agent`; `/motion` is intentionally left to the package-layout task. Spring, React integration and per-segment easing are outside this task; per-segment easing can be additive later.

## Alternatives

- Evaluate easing on unbounded extrapolated progress: rejected because it introduces polynomial/exponential overflow and a separate Bézier extrapolation policy.
- Clamp the final value: rejected because it erases deliberate easing overshoot.
- Return numbers on success and throw on invalid ranges: rejected by the Result/Diagnostic contract.
- Require ascending outputs or constrain Bézier y controls: rejected because descending values and overshoot are valid Pure Motion expression.
