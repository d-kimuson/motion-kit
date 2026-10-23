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
  type RationalInput,
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

const checkSamples = (
  cases: readonly {
    fps: RationalInput;
    time: RationalInput;
    duration: RationalInput;
    frame: number;
    total: number;
  }[],
) => {
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
};

// Convert a rational frame position to exact seconds without floating-point division.
const positionSample = (position: RationalInput, fps: RationalInput) => ({
  fps,
  time: {
    numerator: position.numerator * fps.denominator,
    denominator: position.denominator * fps.numerator,
  },
  duration: { numerator: 1, denominator: 1 },
  frame: 0,
  total: 1,
});

describe('Timeline rational conversions', () => {
  it('matches Lean below, at and above rounding thresholds for unit and rational fps', () => {
    expect.hasAssertions();
    const rates = [
      { numerator: 1, denominator: 1 },
      { numerator: 30000, denominator: 1001 },
    ];
    checkSamples(
      rates.flatMap((fps) => [
        // Regression: a 3/4 nearest bias incorrectly rounds position 1/3 up to 1.
        positionSample({ numerator: 1, denominator: 3 }, fps),
        ...[-2, -1, 0, 1, 2].flatMap((frame) =>
          // Integer (floor/ceil), half (nearest), and the wrong quarter thresholds.
          [0, 250000, 500000, 750000].flatMap((threshold) =>
            [-1, 0, 1].map((epsilon) =>
              positionSample(
                { numerator: frame * 1000000 + threshold + epsilon, denominator: 1000000 },
                fps,
              ),
            ),
          ),
        ),
      ]),
    );
  });

  it('matches Lean at exact signed half-frame ties and one billionth of a frame on either side', () => {
    expect.hasAssertions();
    checkSamples(
      [
        { numerator: 1, denominator: 1 },
        { numerator: 30000, denominator: 1001 },
      ].flatMap((fps) =>
        [-2, -1, 0, 1, 2].flatMap((frame) =>
          [-1, 0, 1].map((epsilon) =>
            // Exact rational positions: ties go toward +infinity. Products in positionSample
            // remain safe integers, including at 30000/1001 fps; no decimal seconds are used.
            positionSample(
              {
                numerator: frame * 1_000_000_000 + 500_000_000 + epsilon,
                denominator: 1_000_000_000,
              },
              fps,
            ),
          ),
        ),
      ),
    );
  });

  it('matches Lean at arbitrary rational positions and on both sides of signed half-frame ties', () => {
    expect.hasAssertions();
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            input: inputs,
            numerator: fc.integer({ min: -1000000, max: 1000000 }),
            denominator: fc.integer({ min: 3, max: 1000000 }),
          }),
          { minLength: 10, maxLength: 10 },
        ),
        (batch) => {
          checkSamples(
            batch.flatMap(({ input: { fps, arbitraryFrame }, numerator, denominator }) => [
              positionSample({ numerator, denominator }, fps),
              ...[-1, 0, 1].map((epsilon) =>
                positionSample(
                  {
                    numerator: (2 * arbitraryFrame + 1) * denominator + epsilon,
                    denominator: 2 * denominator,
                  },
                  fps,
                ),
              ),
            ]),
          );
        },
      ),
      { numRuns: 50 },
    );
  });
  it('matches Lean around signed frame boundaries, last frames, empty timelines and exact counts', () => {
    expect.hasAssertions();
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
        checkSamples(cases);
      }),
      { numRuns: 10 },
    );
  });
});
