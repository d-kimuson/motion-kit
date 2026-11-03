import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  compareTime,
  createFrameRate,
  createTimelineTime,
  frameToTime,
  type FrameRate,
  type TimelineTime,
} from '../core/timeline/time.ts';
import { DiagnosticSchema } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';
import { parseRangeBound, resolveFrameRange, type FrameRange, type RangeBound } from './range.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const time = (numerator: number, denominator = 1): TimelineTime =>
  unwrap(createTimelineTime({ numerator, denominator }));

const rate = (numerator: number, denominator = 1): FrameRate =>
  unwrap(createFrameRate({ numerator, denominator }));

const boundOf = (text: string): RangeBound => unwrap(parseRangeBound(text));

const rangeOf = (options: {
  readonly from?: string;
  readonly to?: string;
  readonly fps: FrameRate;
  readonly durationInFrames: number;
}): FrameRange =>
  unwrap(
    resolveFrameRange({
      fps: options.fps,
      durationInFrames: options.durationInFrames,
      ...(options.from === undefined ? {} : { from: boundOf(options.from) }),
      ...(options.to === undefined ? {} : { to: boundOf(options.to) }),
    }),
  );

describe('parseRangeBound', () => {
  it('reads a bare integer as a Global Frame', () => {
    expect(boundOf('0')).toEqual({ kind: 'frame', frame: 0 });
    expect(boundOf('3600')).toEqual({ kind: 'frame', frame: 3600 });
    // Leading zeros are the same frame, not octal or a different notation.
    expect(boundOf('00012')).toEqual({ kind: 'frame', frame: 12 });
  });

  it('reads seconds with an s suffix as exact decimal seconds', () => {
    expect(boundOf('260s')).toEqual({ kind: 'time', time: time(260) });
    expect(boundOf('4.5s')).toEqual({ kind: 'time', time: time(9, 2) });
    expect(boundOf('0.1s')).toEqual({ kind: 'time', time: time(1, 10) });
  });

  it('reads mm:ss[.fff] as minutes and exact decimal seconds', () => {
    expect(boundOf('4:20')).toEqual({ kind: 'time', time: time(260) });
    expect(boundOf('4:20.5')).toEqual({ kind: 'time', time: time(521, 2) });
    expect(boundOf('0:00')).toEqual({ kind: 'time', time: time(0) });
    expect(boundOf('0:05')).toEqual({ kind: 'time', time: time(5) });
    expect(boundOf('120:00')).toEqual({ kind: 'time', time: time(7200) });
  });

  it.each([
    '',
    ' ',
    ' 4:20',
    '4:20 ',
    'abc',
    '-1',
    '-1s',
    '+5',
    '4.5',
    '4:5.5.5',
    '1:60',
    '1:2:3',
    '4:20m',
    '1sx',
    '0x10',
    '1e3',
    'NaN',
    'Infinity',
    '1,5',
    '9007199254740992',
  ])('rejects %j as cli.invalid-arguments with the notation in the hint', (text) => {
    const result = parseRangeBound(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(DiagnosticSchema.safeParse(result.error).success).toBe(true);
    expect(result.error.code).toBe('cli.invalid-arguments');
    expect(result.error.hint).toContain('4:20');
    expect(result.error.hint).toContain('260s');
  });
});

describe('resolveFrameRange', () => {
  const fps = rate(30);

  it('defaults to the whole Composition', () => {
    expect(rangeOf({ fps, durationInFrames: 90 })).toEqual({ startFrame: 0, endFrame: 90 });
  });

  it('takes a frame bound as the Global Frame it names', () => {
    expect(rangeOf({ fps, durationInFrames: 90, from: '30', to: '45' })).toEqual({
      startFrame: 30,
      endFrame: 45,
    });
  });

  it('rounds both ends up, so the output is the frames whose presentation time is in [from, to)', () => {
    // 1.01 s is between frame 30 (1.0 s) and 31; 1.05 s is between frame 31 and 32 (1.0666… s).
    expect(rangeOf({ fps, durationInFrames: 90, from: '1.01s', to: '1.05s' })).toEqual({
      startFrame: 31,
      endFrame: 32,
    });
    // An exact frame boundary stays that frame: 4:20 at 30 fps is frame 7800.
    expect(rangeOf({ fps, durationInFrames: 8000, from: '4:20', to: '4:20.1' })).toEqual({
      startFrame: 7800,
      endFrame: 7803,
    });
  });

  it('accepts a from and no to (to the end) and a to and no from (from the start)', () => {
    expect(rangeOf({ fps, durationInFrames: 90, from: '1s' })).toEqual({
      startFrame: 30,
      endFrame: 90,
    });
    expect(rangeOf({ fps, durationInFrames: 90, to: '1s' })).toEqual({
      startFrame: 0,
      endFrame: 30,
    });
  });

  type InvalidRange = {
    readonly name: string;
    readonly from: string;
    readonly to?: string;
    readonly durationInFrames: number;
    readonly message: string;
  };
  const invalidRanges: readonly InvalidRange[] = [
    {
      name: 'an empty range',
      from: '45',
      to: '45',
      durationInFrames: 90,
      message: 'starts at frame 45 and ends at frame 45',
    },
    {
      name: 'an inverted range',
      from: '60',
      to: '30',
      durationInFrames: 90,
      message: 'starts at frame 60 and ends at frame 30',
    },
    {
      name: 'a range that starts at the composition end',
      from: '90',
      durationInFrames: 90,
      message: 'starts at frame 90',
    },
    {
      name: 'a range beyond the composition',
      from: '30',
      to: '131',
      durationInFrames: 90,
      message: 'ends at frame 131 but the Composition is 90 frames long',
    },
    {
      name: 'a from beyond the composition',
      from: '200',
      durationInFrames: 90,
      message: 'starts at frame 200 but the Composition is 90 frames long',
    },
  ];
  it.each(invalidRanges)('reports $name as one cli.invalid-arguments diagnostic', (input) => {
    const result = resolveFrameRange({
      fps,
      durationInFrames: input.durationInFrames,
      from: boundOf(input.from),
      ...(input.to === undefined ? {} : { to: boundOf(input.to) }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(DiagnosticSchema.safeParse(result.error).success).toBe(true);
    expect(result.error.code).toBe('cli.invalid-arguments');
    expect(result.error.message).toContain(input.message);
    expect(result.error.hint).not.toBe('');
  });

  it('is the frames whose presentation time lies in [from, to), over generated rates and times', () => {
    const rates = [rate(24), rate(30), rate(30000, 1001), rate(60)];
    fc.assert(
      fc.property(
        fc.constantFrom(...rates),
        fc.nat({ max: 5_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        (fpsValue, fromSeconds, spanSeconds) => {
          const toSeconds = fromSeconds + spanSeconds;
          const durationInFrames = 700_000;
          const range = rangeOf({
            fps: fpsValue,
            durationInFrames,
            from: `${String(fromSeconds)}s`,
            to: `${String(toSeconds)}s`,
          });
          const from = unwrap(createTimelineTime(fromSeconds));
          const to = unwrap(createTimelineTime(toSeconds));
          // No frame before the range is included, and none inside is dropped.
          expect(
            compareTime(frameToTime(BigInt(range.startFrame), fpsValue), from),
          ).toBeGreaterThanOrEqual(0);
          expect(
            range.startFrame === 0 ||
              compareTime(frameToTime(BigInt(range.startFrame - 1), fpsValue), from) < 0,
          ).toBe(true);
          expect(
            compareTime(frameToTime(BigInt(range.endFrame), fpsValue), to),
          ).toBeGreaterThanOrEqual(0);
          expect(
            range.endFrame === 0 ||
              compareTime(frameToTime(BigInt(range.endFrame - 1), fpsValue), to) < 0,
          ).toBe(true);
          expect(range.startFrame).toBeLessThan(range.endFrame);
          expect(range.endFrame).toBeLessThanOrEqual(durationInFrames);
        },
      ),
    );
  });

  it('returns every frame-index range inside the composition unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (start, span) => {
          const end = start + span;
          expect(
            rangeOf({
              fps: rate(30),
              durationInFrames: end,
              from: String(start),
              to: String(end),
            }),
          ).toEqual({ startFrame: start, endFrame: end });
        },
      ),
    );
  });
});
