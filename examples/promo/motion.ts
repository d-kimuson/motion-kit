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

/** How many of `total` characters a typewriter that starts at `start` has written by `time`. */
export const revealed = (time: number, start: number, perSecond: number, total: number): number =>
  Math.min(total, Math.max(0, Math.floor((time - start) * perSecond)));

/** Where `time` falls inside a repeating `period`, from 0 up to (not including) 1. */
export const phase = (time: number, period: number): number =>
  (((time % period) + period) % period) / period;
