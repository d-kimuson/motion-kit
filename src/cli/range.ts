import {
  compareTime,
  createTimelineTime,
  timeToFrameCeil,
  type FrameRate,
  type TimelineTime,
} from '../core/timeline/time.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';

// A render range is written as either a Global Frame or a point in time on the same timeline,
// and the notation says which: a bare integer is a frame, `mm:ss[.fff]` and `<seconds>s` are
// time. Time is converted to frames only by the Time Module, so the range never invents its own
// rounding. The range is half-open: the output holds exactly the frames whose presentation time
// lies in [from, to). `render` and a future audio-only export share these functions.

/** A written end of a range: a Global Frame, or a point in time. */
export type RangeBound =
  | { readonly kind: 'frame'; readonly frame: number }
  | { readonly kind: 'time'; readonly time: TimelineTime };

/** Global frames of the Composition: `startFrame` inclusive, `endFrame` exclusive. */
export type FrameRange = {
  readonly startFrame: number;
  readonly endFrame: number;
};

const notationHint =
  'Write a Global Frame as a bare integer (3600), or a time as mm:ss[.fff] (4:20, 4:20.5) or seconds with an s suffix (260s, 4.5s).';

const parseFailure = (text: string): Result<never> => ({
  ok: false,
  error: {
    code: 'cli.invalid-arguments',
    severity: 'error',
    message: `The range bound ${JSON.stringify(text)} is not a frame number or a time.`,
    hint: notationHint,
  },
});

/** Decimal seconds from an integer and a fraction, exactly: no float ever holds the value. */
const decimalTime = (seconds: string, fraction: string | undefined): Result<TimelineTime> => {
  const digits = fraction ?? '';
  const numerator = Number(`${seconds}${digits}`);
  const denominator = 10 ** digits.length;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    return parseFailure(`${seconds}${digits === '' ? '' : `.${digits}`}`);
  return createTimelineTime({ numerator, denominator });
};

/**
 * Reads one written range end. The notation decides the unit, so `260` is frame 260 while `260s`
 * and `4:20` are points in time; a decimal without a unit (`4.5`) is rejected rather than guessed.
 */
export const parseRangeBound = (text: string): Result<RangeBound> => {
  if (/^\d+$/u.test(text)) {
    const frame = Number(text);
    if (!Number.isSafeInteger(frame)) return parseFailure(text);
    return { ok: true, value: { kind: 'frame', frame } };
  }
  const seconds = /^(\d+)(?:\.(\d+))?s$/u.exec(text);
  if (seconds !== null) {
    const value = decimalTime(seconds[1] ?? '', seconds[2]);
    return value.ok ? { ok: true, value: { kind: 'time', time: value.value } } : value;
  }
  const minutes = /^(\d+):([0-5]?\d)(?:\.(\d+))?$/u.exec(text);
  if (minutes !== null) {
    const wholeMinutes = Number(minutes[1]);
    if (!Number.isSafeInteger(wholeMinutes * 60)) return parseFailure(text);
    const value = decimalTime(String(wholeMinutes * 60 + Number(minutes[2] ?? 0)), minutes[3]);
    return value.ok ? { ok: true, value: { kind: 'time', time: value.value } } : value;
  }
  return parseFailure(text);
};

const rangeFailure = (message: string, hint: string): Result<never> => ({
  ok: false,
  error: { code: 'cli.invalid-arguments', severity: 'error', message, hint } satisfies Diagnostic,
});

/** The Global Frame a bound names; a time rounds up, so no frame before it is included. */
const boundToFrame = (bound: RangeBound, rate: FrameRate): Result<number> => {
  if (bound.kind === 'frame') return { ok: true, value: bound.frame };
  const frame = timeToFrameCeil(bound.time, rate);
  if (frame > BigInt(Number.MAX_SAFE_INTEGER))
    return rangeFailure(
      'The range bound is too far into the timeline to be a frame.',
      'Choose a bound that converts to a safe integer frame number.',
    );
  return { ok: true, value: Number(frame) };
};

/**
 * Rejects an empty or reversed range that the written bounds alone decide. Two bounds in one unit
 * are comparable without the Composition: frames directly, and times by their own value, because
 * `ceil` is monotonic, so `from >= to` gives `startFrame >= endFrame` at every rate. A mixed pair
 * (`2s` and `30`) can only be compared once the frame rate is known, and the Composition's frame
 * count is needed for every bound anyway; `resolveFrameRange` keeps checking those.
 */
export const checkRangeOrder = (options: {
  readonly from?: RangeBound | undefined;
  readonly to?: RangeBound | undefined;
}): Result<undefined> => {
  const { from, to } = options;
  if (from === undefined || to === undefined) return { ok: true, value: undefined };
  const reversed =
    (from.kind === 'frame' && to.kind === 'frame' && from.frame >= to.frame) ||
    (from.kind === 'time' && to.kind === 'time' && compareTime(from.time, to.time) >= 0);
  return reversed
    ? rangeFailure(
        'The range starts at or after the point it ends, so it holds no frames.',
        'Choose --from before --to, leaving at least one frame in the range.',
      )
    : { ok: true, value: undefined };
};

/**
 * Resolves written ends against the Composition the render actually mounted. `durationInFrames`
 * is the descriptor's resolved frame count, so a range follows the Composition rather than a
 * second reading of its length. A range outside the Composition, or one with no frames, is an
 * invocation error and no output is written.
 */
export const resolveFrameRange = (options: {
  readonly from?: RangeBound | undefined;
  readonly to?: RangeBound | undefined;
  readonly fps: FrameRate;
  readonly durationInFrames: number;
}): Result<FrameRange> => {
  let startFrame = 0;
  if (options.from !== undefined) {
    const start = boundToFrame(options.from, options.fps);
    if (!start.ok) return start;
    startFrame = start.value;
  }
  let endFrame = options.durationInFrames;
  if (options.to !== undefined) {
    const end = boundToFrame(options.to, options.fps);
    if (!end.ok) return end;
    endFrame = end.value;
  }
  if (endFrame > options.durationInFrames)
    return rangeFailure(
      `The range ends at frame ${String(endFrame)} but the Composition is ${String(options.durationInFrames)} frames long.`,
      'Choose --to at or before the Composition end, or drop it to render to the end.',
    );
  if (startFrame > options.durationInFrames)
    return rangeFailure(
      `The range starts at frame ${String(startFrame)} but the Composition is ${String(options.durationInFrames)} frames long.`,
      'Choose --from inside the Composition, or drop it to render from the start.',
    );
  if (startFrame >= endFrame)
    return rangeFailure(
      `The range starts at frame ${String(startFrame)} and ends at frame ${String(endFrame)}, so it holds no frames.`,
      'Choose --from before --to, leaving at least one frame in the range.',
    );
  return { ok: true, value: { startFrame, endFrame } };
};
