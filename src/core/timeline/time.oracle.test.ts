import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { evalSpecs } from '../../../spec/oracle.ts';
import { type Result } from '../../lib/result.ts';
import {
  createFrameRate,
  createTimelineTime,
  frameCount,
  framePosition,
  frameToTime,
  timeToFrameCeil,
  timeToFrameFloor,
  timeToFrameNearest,
  validateOutputFrame,
  type TimelineTime,
} from './time.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const output = (value: TimelineTime) => ({
  numerator: String(value.numerator),
  denominator: String(value.denominator),
});

// Safe integer wire components become exact Lean Rat / bigint rationals. Generators satisfy fps > 0.
const inputs = fc.record({
  fps: fc.oneof(
    fc.constant({ numerator: 30000, denominator: 1001 }),
    fc.record({
      numerator: fc.integer({ min: 1, max: 60000 }),
      denominator: fc.integer({ min: 1, max: 1001 }),
    }),
  ),
  total: fc.integer({ min: 0, max: 1000 }),
  arbitraryFrame: fc.integer({ min: -10000, max: 10000 }),
});

describe('Timeline rational conversions', () => {
  it('matches Lean around signed frame boundaries, last frames, empty timelines and exact counts', () => {
    // Batch oracle requests: property shrinking still retains the failing batch and all exact inputs.
    fc.assert(
      fc.property(fc.array(inputs, { minLength: 10, maxLength: 10 }), (batch) => {
        const cases = batch.flatMap(({ fps, total, arbitraryFrame }) =>
          [-1, 0, total - 1, total, total + 1, arbitraryFrame].flatMap((frame) =>
            [-1, 0, 1].map((halfOffset) => ({
              fps,
              total,
              frame,
              time: {
                numerator: (2 * frame + halfOffset) * fps.denominator,
                denominator: 2 * fps.numerator,
              },
              duration:
                halfOffset === 0
                  ? { numerator: total * fps.denominator, denominator: fps.numerator }
                  : { numerator: 1, denominator: 10 },
            })),
          ),
        );
        cases.push({
          fps: { numerator: Number.MAX_SAFE_INTEGER, denominator: 1001 },
          frame: Number.MAX_SAFE_INTEGER,
          total: Number.MAX_SAFE_INTEGER,
          time: { numerator: Number.MAX_SAFE_INTEGER, denominator: 1001 },
          duration: { numerator: Number.MAX_SAFE_INTEGER, denominator: 1001 },
        });
        const expected = evalSpecs(cases.map((args) => ({ fn: 'Timeline.sample', args })));
        expect(
          cases.map((args) => {
            const fps = unwrap(createFrameRate(args.fps));
            const time = unwrap(createTimelineTime(args.time));
            return {
              time: output(frameToTime(BigInt(args.frame), fps)),
              position: output(framePosition(time, fps)),
              floor: String(timeToFrameFloor(time, fps)),
              ceil: String(timeToFrameCeil(time, fps)),
              nearest: String(timeToFrameNearest(time, fps)),
              count: String(unwrap(frameCount(unwrap(createTimelineTime(args.duration)), fps))),
              valid: validateOutputFrame(args.frame, BigInt(args.total)).ok,
            };
          }),
        ).toEqual(expected);
      }),
      { numRuns: 10 },
    );
  });
});
