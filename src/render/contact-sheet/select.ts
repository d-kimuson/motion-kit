import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { maxTiles } from './layout.ts';

// Which frames a Contact Sheet shows. The choice is data, not a side effect of capturing: a step
// (`--every`) walks the region from its first frame and always ends on its last, and explicit
// frames are taken as written. Both shapes are resolved here so the sheet, the envelope and the
// tests read the same list.

/** Half-open Global Frame region a sheet draws from: `startFrame` inclusive, `endFrame` exclusive. */
export type ContactSheetRegion = {
  readonly startFrame: number;
  readonly endFrame: number;
};

export type ContactSheetFrameSpec =
  | { readonly kind: 'every'; readonly every: number }
  | { readonly kind: 'frames'; readonly frames: readonly number[] };

const invalid = (message: string, hint: string): Result<never, readonly Diagnostic[]> => ({
  ok: false,
  error: [
    {
      code: 'cli.invalid-arguments',
      severity: 'error',
      message,
      hint,
    },
  ],
});

/**
 * The tile cap as one Diagnostic, with the hint that fits the selection the caller used: a stepped
 * sheet is fixed by raising `--every` or narrowing the region, an explicit one by naming fewer
 * frames. The CLI forbids both options at once, so the hint never sends the caller to the other one.
 */
const tooMany = (count: number, spec: ContactSheetFrameSpec): Diagnostic => ({
  code: 'cli.invalid-arguments',
  severity: 'error',
  message: `The sheet would hold ${String(count)} tiles, but one contact sheet holds 1 to ${String(maxTiles)}.`,
  hint:
    spec.kind === 'every'
      ? `Raise --every until the sheet holds at most ${String(maxTiles)} frames, or narrow the range with --from and --to.`
      : `Name at most ${String(maxTiles)} frames, or select the tiles with --every instead of --frame.`,
});

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * The frames `spec` selects from `region`, ascending and unique. A step always keeps the region's
 * last frame, because the end of a region is where a review looks for the finished state.
 */
export const selectContactSheetFrames = (options: {
  readonly spec: ContactSheetFrameSpec;
  readonly region: ContactSheetRegion;
}): Result<readonly number[], readonly Diagnostic[]> => {
  const { spec } = options;
  const { startFrame, endFrame } = options.region;
  if (!isPositiveInteger(startFrame) && startFrame !== 0)
    return invalid(
      'The range start must be a nonnegative integer.',
      'Choose --from at or after frame 0.',
    );
  if (!isPositiveInteger(endFrame) || endFrame <= startFrame)
    return invalid(
      'The range holds no frames.',
      'Choose --from before --to, leaving at least one frame in the range.',
    );
  if (spec.kind === 'every') {
    if (!isPositiveInteger(spec.every))
      return invalid(
        'The step must be a positive integer.',
        'Use --every with a positive integer, for example 150.',
      );
    const frames: number[] = [];
    for (let frame = startFrame; frame < endFrame; frame += spec.every) frames.push(frame);
    const last = endFrame - 1;
    if (frames.at(-1) !== last) frames.push(last);
    return frames.length > maxTiles
      ? { ok: false, error: [tooMany(frames.length, spec)] }
      : { ok: true, value: frames };
  }
  const problems: Diagnostic[] = [];
  const frames: number[] = [];
  for (const frame of spec.frames) {
    if (!Number.isSafeInteger(frame) || frame < startFrame || frame >= endFrame)
      problems.push({
        code: 'cli.invalid-arguments',
        severity: 'error',
        message: `Frame ${String(frame)} is outside the sheet's frame range.`,
        hint: `Use --frame with safe integers from ${String(startFrame)} to ${String(endFrame - 1)}, or widen --from and --to.`,
      });
    else if (frames.includes(frame))
      problems.push({
        code: 'cli.invalid-arguments',
        severity: 'error',
        message: `Frame ${String(frame)} is named twice.`,
        hint: 'Name each frame once; a sheet shows one tile per frame.',
      });
    else frames.push(frame);
  }
  if (problems.length > 0) return { ok: false, error: problems };
  if (frames.length === 0)
    return invalid(
      'The sheet has no frames.',
      'Name at least one --frame, or choose a step with --every.',
    );
  if (frames.length > maxTiles) return { ok: false, error: [tooMany(frames.length, spec)] };
  return { ok: true, value: frames.sort((a, b) => a - b) };
};
