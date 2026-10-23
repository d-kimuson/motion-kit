import type { Result } from '../lib/result.ts';

import { interpolate, type InterpolateOptions } from './interpolate.ts';

export type Keyframe = { readonly time: number; readonly value: number };

/** At least two strictly ascending finite times in seconds; options apply to every segment. */
export const keyframes = (
  time: number,
  frames: readonly Keyframe[],
  options: InterpolateOptions = {},
): Result<number> => {
  return interpolate(
    time,
    frames.map((frame) => frame.time),
    frames.map((frame) => frame.value),
    options,
  );
};
