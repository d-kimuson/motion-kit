import type { Result } from '../lib/result.ts';

import { finiteResult, invalidInput } from './diagnostic.ts';
import { easing, type Easing } from './easing.ts';

export type InterpolateOptions = {
  /** Default clamp. Extend continues the raw outer segment slope; identity returns outside input unchanged. */
  readonly extrapolate?: 'clamp' | 'extend' | 'identity';
  /** Applied to each segment's clamped progress. Default linear; overshoot is not re-clamped. */
  readonly easing?: Easing;
};

const progress = (input: number, start: number, end: number): number => {
  const width = end - start;
  const offset = input - start;
  // Halving avoids overflow when finite operands span nearly all binary64.
  return Number.isFinite(width) && Number.isFinite(offset)
    ? offset / width
    : (input / 2 - start / 2) / (end / 2 - start / 2);
};

const mix = (from: number, to: number, p: number): number => {
  if (p === 0 || from === to) return from;
  if (p === 1) return to;
  // A convex combination avoids overflowing to-from on opposite-sign endpoints.
  return p > 0 && p < 1 ? from * (1 - p) + to * p : from + (to - from) * p;
};

/**
 * Pure numeric interpolation, with plain seconds (or any consistent numeric unit).
 * Ranges need matching lengths >=2, finite values and strictly ascending inputs.
 * Default clamp/linear. Clamp affects progress, not an easing's overshooting value.
 * Extend continues the first/last segment's raw linear slope outside the range;
 * identity returns the original input outside the whole range only.
 * Invalid inputs and non-finite results are Diagnostics, never thrown failures.
 */
export const interpolate = (
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): Result<number> => {
  const [first, second] = inputRange;
  const [firstOutput, secondOutput] = outputRange;
  if (
    first === undefined ||
    second === undefined ||
    firstOutput === undefined ||
    secondOutput === undefined ||
    !Number.isFinite(input) ||
    inputRange.length < 2 ||
    inputRange.length !== outputRange.length
  ) {
    return invalidInput(
      'Interpolation requires a finite input and matching ranges of at least two values.',
      'Provide a finite input and equally sized input/output ranges with at least two stops.',
    );
  }
  let start = first;
  let end = second;
  let from = firstOutput;
  let to = secondOutput;
  let previous: number | undefined;
  for (let index = 0; index < inputRange.length; index += 1) {
    const current = inputRange[index];
    const output = outputRange[index];
    if (
      current === undefined ||
      output === undefined ||
      !Number.isFinite(current) ||
      !Number.isFinite(output) ||
      (previous !== undefined && current <= previous)
    ) {
      return invalidInput(
        'Interpolation ranges contain non-finite values or non-increasing inputs.',
        'Use finite values and strictly ascending, distinct input stops.',
      );
    }
    if (index > 1 && input > end) {
      start = end;
      from = to;
      end = current;
      to = output;
    }
    previous = current;
  }

  const mode = options.extrapolate ?? 'clamp';
  const ease = options.easing ?? easing.linear;
  const outside = input < start || input > end;
  if (mode === 'identity' && outside) return finiteResult(input);
  const clamped = input <= start ? 0 : input >= end ? 1 : progress(input, start, end);
  const eased = ease(clamped);
  if (!Number.isFinite(eased)) return finiteResult(eased);
  const base = mix(from, to, eased);
  if (mode !== 'extend' || !outside || from === to) return finiteResult(base);

  const p = progress(input, start, end);
  return finiteResult(base + (p - clamped) * (to - from));
};
