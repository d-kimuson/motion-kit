import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DiagnosticSchema } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import {
  addTime,
  compareTime,
  createFrameRate,
  createTimelineTime,
  durationFromFrameCount,
  frameCount,
  framePosition,
  frameToTime,
  subtractTime,
  timeToFrameCeil,
  timeToFrameFloor,
  timeToFrameNearest,
  toSeconds,
  validateOutputFrame,
} from './time.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const time = (numerator: number, denominator = 1) =>
  unwrap(createTimelineTime({ numerator, denominator }));
const fps = unwrap(createFrameRate({ numerator: 30000, denominator: 1001 }));

describe('Time Module contract', () => {
  it('keeps decimal seconds exact and supports an exact rational input', () => {
    expect(unwrap(createTimelineTime(0.1))).toEqual(time(1, 10));
    expect(unwrap(createTimelineTime(-1.25))).toEqual(time(-5, 4));
    expect(unwrap(createTimelineTime(1e-7))).toEqual(time(1, 10_000_000));
    expect(unwrap(createTimelineTime(-0))).toEqual(time(0));
    expect(toSeconds(unwrap(createTimelineTime(Number.MIN_VALUE)))).toBe(Number.MIN_VALUE);
    expect(toSeconds(unwrap(createTimelineTime(-1e-300)))).toBe(-1e-300);
    expect(time(2, 6)).toEqual(time(1, 3));
    expect(toSeconds(time(1, 4))).toBe(0.25);
    expect(addTime(time(1, 3), time(1, 6))).toEqual(time(1, 2));
    expect(subtractTime(time(1, 3), time(1, 2))).toEqual(time(-1, 6));
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid seconds %s at the boundary',
    (input) => {
      const result = createTimelineTime(input);
      expect(result.ok).toBe(false);
      expect(DiagnosticSchema.safeParse(result.ok ? undefined : result.error).success).toBe(true);
    },
  );

  it.each([
    { numerator: 1.5, denominator: 1 },
    { numerator: 1, denominator: 0 },
    { numerator: 1, denominator: -1 },
    { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1 },
    { numerator: 1, denominator: Infinity },
  ])('rejects invalid rational components %j', (input) => {
    expect(createTimelineTime(input).ok).toBe(false);
    expect(createFrameRate(input).ok).toBe(false);
  });

  it('requires positive fps, but accepts signed time', () => {
    expect(createFrameRate({ numerator: 0, denominator: 1 }).ok).toBe(false);
    expect(createFrameRate({ numerator: -30, denominator: 1 }).ok).toBe(false);
    expect(createTimelineTime(-1).ok).toBe(true);
  });

  it('rounds signed fractional frames only in the named conversion', () => {
    const unitFps = unwrap(createFrameRate({ numerator: 1, denominator: 1 }));
    expect(timeToFrameFloor(time(-1, 2), unitFps)).toBe(-1n);
    expect(timeToFrameCeil(time(-1, 2), unitFps)).toBe(0n);
    expect(timeToFrameNearest(time(-1, 2), unitFps)).toBe(0n);
    expect(timeToFrameNearest(time(1, 2), unitFps)).toBe(1n);
    expect(framePosition(time(1, 10), fps)).toEqual(time(3000, 1001));
  });

  it('counts samples using exact ceil and reports the inverse duration', () => {
    expect(unwrap(frameCount(time(1, 10), fps))).toBe(3n);
    expect(unwrap(frameCount(time(0), fps))).toBe(0n);
    expect(unwrap(durationFromFrameCount(3n, fps))).toEqual(time(1001, 10000));
    expect(frameCount(time(-1), fps).ok).toBe(false);
    expect(durationFromFrameCount(-1n, fps).ok).toBe(false);
    // Floating division/multiplication puts exact boundaries above their integer frames.
    const decimalFps = unwrap(createFrameRate({ numerator: 2997, denominator: 100 }));
    expect(Math.ceil((1000 / 29.97) * 29.97)).toBe(1001);
    expect(unwrap(frameCount(frameToTime(1000n, decimalFps), decimalFps))).toBe(1000n);
    expect(Math.ceil((30 / (30000 / 1001)) * (30000 / 1001))).toBe(31);
    expect(unwrap(frameCount(frameToTime(30n, fps), fps))).toBe(30n);
  });

  it('validates output requests without clamping or throwing', () => {
    expect(unwrap(validateOutputFrame(9, 10n))).toBe(9n);
    for (const frame of [-1, 10, 11, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = validateOutputFrame(frame, 10n);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ ok: false, error: { code: 'composition.props-invalid' } });
    }
    expect(validateOutputFrame(0, 0n).ok).toBe(false);
  });

  it('locates rejected safe-integer output frames in a valid Diagnostic', () => {
    for (const [frame, total] of [
      [-1, 10n],
      [10, 10n],
      [11, 10n],
      [0, 0n],
    ] as const) {
      const result = validateOutputFrame(frame, total);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'composition.props-invalid', location: { frame } },
      });
      if (result.ok) throw new Error('Expected a rejected frame');
      expect(DiagnosticSchema.safeParse(result.error).success).toBe(true);
      expect(result.error.details).toBeUndefined();
    }
  });

  it('names malformed output frames without an unrepresentable Diagnostic location', () => {
    for (const frame of [0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = validateOutputFrame(frame, 10n);
      if (result.ok) throw new Error('Expected a rejected frame');
      expect(result.error.message).toContain(`"${String(frame)}"`);
      expect(result.error.location).toBeUndefined();
      expect(result.error.details).toBeUndefined();
      expect(DiagnosticSchema.safeParse(result.error).success).toBe(true);
    }
  });

  it('round-trips signed frame identity and count duration with non-unit rational fps', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (frame) => {
        const value = BigInt(frame);
        const presentationTime = frameToTime(value, fps);
        expect(timeToFrameFloor(presentationTime, fps)).toBe(value);
        expect(timeToFrameCeil(presentationTime, fps)).toBe(value);
        expect(timeToFrameNearest(presentationTime, fps)).toBe(value);
        const count = value < 0n ? -value : value;
        expect(unwrap(frameCount(unwrap(durationFromFrameCount(count, fps)), fps))).toBe(count);
      }),
    );
  });

  it('is monotonic and retains exact products beyond the safe-integer range', () => {
    fc.assert(
      fc.property(fc.integer(), fc.nat(), (start, offset) => {
        const a = time(start, 1001);
        const b = time(start + offset, 1001);
        expect(compareTime(a, b)).toBeLessThanOrEqual(0);
        expect(timeToFrameFloor(a, fps) <= timeToFrameFloor(b, fps)).toBe(true);
      }),
    );
    const huge = time(Number.MAX_SAFE_INTEGER, 1001);
    expect(timeToFrameFloor(frameToTime(9007199254740991000n, fps), fps)).toBe(
      9007199254740991000n,
    );
    expect(subtractTime(addTime(huge, time(1, 30000)), huge)).toEqual(time(1, 30000));
  });
});
