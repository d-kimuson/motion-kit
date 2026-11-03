// The promo's motion, written over the published Pure Motion values (`@kimuson/motion-kit/motion`).
// Every helper takes the time as an argument and remembers nothing, so any frame can be rendered
// first. The stops and spring constants are module constants, so a failed `Result` here is a
// programmer error and throws instead of drawing a wrong frame.

import { easing, type Easing, interpolate, type Result, spring } from '@kimuson/motion-kit/motion';

const unwrap = (result: Result<number>): number => {
  if (!result.ok) throw new Error(`promo motion: ${result.error.message}`);
  return result.value;
};

/** `values[0]` before `range[0]`, `values[1]` after `range[1]`, eased in between. */
export const ease = (
  time: number,
  range: readonly [number, number],
  values: readonly [number, number],
  curve: Easing = easing.easeOutCubic,
): number => unwrap(interpolate(time, [...range], [...values], { easing: curve }));

/** A spring from 0 to 1 released at `start`: a few percent of overshoot, settled in about 0.6 s. */
export const pop = (time: number, start: number, stiffness = 220, damping = 17): number =>
  unwrap(spring(time, { from: 0, to: 1, start, velocity: 0, stiffness, damping, mass: 1 }));

/** A frame rate as two integers; `useTimeline().frameRate` is one. */
export type Rate = { readonly numerator: bigint; readonly denominator: bigint };

// Milliseconds elapsed since `startMs` at whole local `frame`, scaled by the rate's numerator so the
// value stays an integer. Every count below divides one integer by another, and the floor of such a
// quotient is exact: a seconds-based `Math.floor((time - start) / step)` lands a frame late whenever
// the float quotient falls just below a whole number (`(1.4 - 0.8) / 0.3` is `1.9999999999999996`).
const scaledElapsedMs = (frame: number, rate: Rate, startMs: number): number =>
  frame * Number(rate.denominator) * 1000 - startMs * Number(rate.numerator);

/** How many whole `everyMs` steps have passed at local `frame` since `startMs`; negative before it. */
export const steps = (frame: number, rate: Rate, startMs: number, everyMs: number): number =>
  Math.floor(scaledElapsedMs(frame, rate, startMs) / (everyMs * Number(rate.numerator)));

/** How many of `total` characters a typewriter that starts at `startMs` and writes `perSecond` of them
 * each second has written at local `frame`. */
export const revealed = (
  frame: number,
  rate: Rate,
  startMs: number,
  perSecond: number,
  total: number,
): number =>
  Math.min(
    total,
    Math.max(
      0,
      Math.floor(
        (scaledElapsedMs(frame, rate, startMs) * perSecond) / (1000 * Number(rate.numerator)),
      ),
    ),
  );

/** Where `time` falls inside a repeating `period`, from 0 up to (not including) 1. */
export const phase = (time: number, period: number): number =>
  (((time % period) + period) % period) / period;
