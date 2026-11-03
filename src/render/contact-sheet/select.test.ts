import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { maxTiles } from './layout.ts';
import { selectContactSheetFrames } from './select.ts';

const every = (options: { startFrame: number; endFrame: number; every: number }) =>
  selectContactSheetFrames({
    spec: { kind: 'every', every: options.every },
    region: { startFrame: options.startFrame, endFrame: options.endFrame },
  });

const explicit = (options: { startFrame: number; endFrame: number; frames: readonly number[] }) =>
  selectContactSheetFrames({
    spec: { kind: 'frames', frames: options.frames },
    region: { startFrame: options.startFrame, endFrame: options.endFrame },
  });

const failureOf = (result: ReturnType<typeof every>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
};

describe('selectContactSheetFrames', () => {
  it('takes every nth frame from the range start and always ends on its last frame', () => {
    expect(every({ startFrame: 0, endFrame: 100, every: 30 })).toEqual({
      ok: true,
      value: [0, 30, 60, 90, 99],
    });
    // The range start is where the lattice begins, so a ranged sheet still shows its first frame.
    expect(every({ startFrame: 50, endFrame: 100, every: 20 })).toEqual({
      ok: true,
      value: [50, 70, 90, 99],
    });
  });

  it('keeps the last frame without repeating it when the lattice already landed on it', () => {
    expect(every({ startFrame: 0, endFrame: 100, every: 33 })).toEqual({
      ok: true,
      value: [0, 33, 66, 99],
    });
  });

  it('takes a single frame from a one-frame region', () => {
    expect(every({ startFrame: 7, endFrame: 8, every: 150 })).toEqual({ ok: true, value: [7] });
  });

  it('takes the explicitly named frames unchanged when they are inside the range', () => {
    expect(explicit({ startFrame: 0, endFrame: 100, frames: [3, 40, 99] })).toEqual({
      ok: true,
      value: [3, 40, 99],
    });
  });

  it('rejects an explicit frame outside the range as an invocation error', () => {
    for (const frames of [[-1], [100], [3, 120]]) {
      const failure = failureOf(explicit({ startFrame: 90, endFrame: 100, frames }));
      expect(failure).toHaveLength(frames.length);
      expect(failure[0]).toMatchObject({
        code: 'cli.invalid-arguments',
        severity: 'error',
      });
      expect(failure[0]?.hint).toContain('--frame');
    }
  });

  it('rejects a step that is not a positive integer', () => {
    for (const step of [0, -1, 1.5, Number.NaN]) {
      const failure = failureOf(every({ startFrame: 0, endFrame: 10, every: step }));
      expect(failure[0]).toMatchObject({ code: 'cli.invalid-arguments' });
    }
  });

  it('rejects an empty region and an explicit request that repeats a frame', () => {
    expect(failureOf(every({ startFrame: 10, endFrame: 10, every: 5 }))[0]).toMatchObject({
      code: 'cli.invalid-arguments',
    });
    expect(failureOf(explicit({ startFrame: 0, endFrame: 10, frames: [2, 2] }))[0]).toMatchObject({
      code: 'cli.invalid-arguments',
    });
    expect(failureOf(explicit({ startFrame: 0, endFrame: 10, frames: [] }))[0]).toMatchObject({
      code: 'cli.invalid-arguments',
    });
  });

  it('refuses more tiles than one sheet holds, naming the shape the caller used', () => {
    const stepped = failureOf(every({ startFrame: 0, endFrame: 1_000, every: 1 }));
    expect(stepped[0]).toMatchObject({ code: 'cli.invalid-arguments' });
    expect(stepped[0]?.message).toContain(String(maxTiles));
    expect(stepped[0]?.hint).toContain('--every');
    // The CLI rejects --every with --frame, so the explicit path must not be told to use it alone.
    const explicitFrames = failureOf(
      explicit({
        startFrame: 0,
        endFrame: 1_000,
        frames: Array.from({ length: maxTiles + 1 }, (_unused, index) => index),
      }),
    );
    expect(explicitFrames[0]).toMatchObject({ code: 'cli.invalid-arguments' });
    expect(explicitFrames[0]?.hint).toContain('--frame');
  });

  it('selects ascending, unique frames inside the range, ending on its last frame', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 64 }),
        (startFrame, length, step) => {
          const result = every({ startFrame, endFrame: startFrame + length, every: step });
          if (!result.ok) return true; // too many tiles for one sheet: covered above.
          const frames = result.value;
          expect(frames.length).toBeGreaterThan(0);
          expect(frames.length).toBeLessThanOrEqual(maxTiles);
          expect(frames.every((frame) => frame >= startFrame && frame < startFrame + length)).toBe(
            true,
          );
          expect(new Set(frames).size).toBe(frames.length);
          expect(frames).toEqual([...frames].sort((a, b) => a - b));
          expect(frames[0]).toBe(startFrame);
          expect(frames.at(-1)).toBe(startFrame + length - 1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
