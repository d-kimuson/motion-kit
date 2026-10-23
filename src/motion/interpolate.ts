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
  // Opposite-sign endpoints must not materialise to-from: it can overflow
  // even when a weighted sum (including easing overshoot) is representable.
  if ((from <= 0 && to >= 0) || (from >= 0 && to <= 0)) {
    return from * (1 - p) + to * p;
  }
  // Same-sign endpoints have a finite difference. Anchor at the nearer end
  // so a large endpoint is not multiplied by an overshooting progress.
  const anchor = p > 1 ? to : from;
  const deviation = p > 1 ? p - 1 : p;
  const result = anchor + deviation * (to - from);
  // A product can overflow before cancellation with the anchor. Half-scale
  // that sum, not its final result; genuine overflow still remains infinite.
  return Number.isFinite(result) ? result : (anchor / 2 + deviation * ((to - from) / 2)) * 2;
};

// A finite difference as fraction * 2^exponent, without materialising an
// overflowing subtraction. Used only to retry non-finite extension arithmetic.
const scaledDifference = (a: number, b: number): { fraction: number; exponent: number } => {
  const difference = a - b;
  if (!Number.isFinite(difference)) {
    // Normalize the halved subtraction relative to 2^1023, which is finite.
    // The fraction describes that half, so its original scale is 2^1024,
    // not 2^1023: restore the lost factor two before combining exponents.
    const halfDifference = a / 2 - b / 2;
    const halfExponent = 1023;
    const originalExponent = halfExponent + 1;
    return { fraction: halfDifference / 2 ** halfExponent, exponent: originalExponent };
  }
  const exponent = Math.min(1023, Math.floor(Math.log2(Math.abs(difference))));
  return { fraction: difference / 2 ** exponent, exponent };
};

const scaledExtension = (
  base: number,
  input: number,
  endpoint: number,
  start: number,
  end: number,
  from: number,
  to: number,
): number => {
  const distance = scaledDifference(input, endpoint);
  const width = scaledDifference(end, start);
  const output = scaledDifference(to, from);
  const coefficient = (distance.fraction * output.fraction) / width.fraction;
  const shift = Math.floor(Math.log2(Math.abs(coefficient)));
  const fraction = coefficient / 2 ** shift;
  const exponent = distance.exponent + output.exponent - width.exponent + shift;
  // A term beyond twice MAX_VALUE cannot be cancelled by a finite base.
  if (exponent > 1024) return fraction * Infinity;
  if (exponent === 1024) return (base / 2 + fraction * 2 ** 1023) * 2;
  // Scale subnormal terms last, so the power of two does not underflow first.
  const term =
    exponent < -1022
      ? fraction * 2 ** (exponent + 1074) * Number.MIN_VALUE
      : fraction * 2 ** exponent;
  return base + term;
};

/**
 * Pure numeric interpolation, with plain seconds (or any consistent numeric unit).
 * Ranges need matching lengths >=2, finite values and strictly ascending inputs.
 * Exact stops return their values without easing; easing shapes segment interiors.
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

  // Exact interior stops belong to the segment ending there (input > end above).
  // Validate the entire range first, then bypass easing at every exact stop.
  if (input === first) return finiteResult(firstOutput);
  if (input === end) return finiteResult(to);

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
  const leftover = p - clamped;
  const slope = to - from;
  // Distribute before subtracting when the raw output difference overflows.
  // For endpoint-preserving easing these terms extend away from the endpoint.
  const result = Number.isFinite(slope)
    ? base + leftover * slope
    : base + leftover * to - leftover * from;
  if (Number.isFinite(result) || !Number.isFinite(base)) return finiteResult(result);
  // Progress itself or its product can overflow before a finite result. Retry
  // the raw slope in exponent space, including cancellation with the base.
  return finiteResult(
    scaledExtension(base, input, clamped === 0 ? start : end, start, end, from, to),
  );
};
