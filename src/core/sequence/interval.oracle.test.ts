import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { evalSpecs } from '../../../spec/oracle.ts';
import { type Result } from '../../lib/result.ts';
import {
  addTime,
  createFrameRate,
  createTimelineTime,
  frameToTime,
  type TimelineTime,
} from '../timeline/time.ts';
import { createSequence, sequenceContains, sequenceLocalTime } from './interval.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const time = (numerator: number, denominator = 1) =>
  unwrap(createTimelineTime({ numerator, denominator }));
const wire = (value: TimelineTime) => ({
  numerator: Number(value.numerator),
  denominator: Number(value.denominator),
});
const output = (value: TimelineTime) => ({
  numerator: String(value.numerator),
  denominator: String(value.denominator),
});

// Nonnegative durations, signed starts and exact rational boundaries; empty intervals are intentional.
const inputs = fc.record({
  start: fc.integer({ min: -10000, max: 10000 }),
  duration: fc.nat(10000),
  denominator: fc.integer({ min: 1, max: 1001 }),
  offset: fc.integer({ min: -1, max: 1 }),
});

describe('Sequence interval', () => {
  it('matches Lean at the start, end, and neighboring rational times', () => {
    fc.assert(
      fc.property(fc.array(inputs, { minLength: 10, maxLength: 10 }), (batch) => {
        const cases = batch.flatMap(({ start, duration, denominator, offset }) => {
          const sequence = unwrap(
            createSequence(time(start, denominator), time(duration, denominator)),
          );
          return [
            sequence.start,
            sequence.end,
            time(start + offset, denominator),
            time(start + duration + offset, denominator),
          ].map((t) => ({
            args: { start: wire(sequence.start), end: wire(sequence.end), time: wire(t) },
            actual: {
              contains: sequenceContains(sequence, t),
              localTime: output(sequenceLocalTime(sequence, t)),
            },
          }));
        });
        expect(cases.map((entry) => entry.actual)).toEqual(
          evalSpecs(cases.map(({ args }) => ({ fn: 'Sequence.sample', args }))),
        );
      }),
      { numRuns: 10 },
    );
  });

  it('keeps a zero-length sequence empty and adjacent sequences disjoint', () => {
    const empty = unwrap(createSequence(time(-1, 3), time(0)));
    expect(sequenceContains(empty, empty.start)).toBe(false);
    fc.assert(
      fc.property(inputs, ({ start, duration, denominator }) => {
        const first = unwrap(createSequence(time(start, denominator), time(duration, denominator)));
        const second = unwrap(createSequence(first.end, time(duration, denominator)));
        for (const t of [first.start, first.end, second.end]) {
          expect(sequenceContains(first, t) && sequenceContains(second, t)).toBe(false);
        }
      }),
    );
  });

  it('selects the last sampled frame and excludes the first frame past the end at rational fps', () => {
    const fps = unwrap(createFrameRate({ numerator: 30000, denominator: 1001 }));
    const sequence = unwrap(createSequence(time(0), time(1)));
    const times = [
      frameToTime(-1n, fps),
      frameToTime(0n, fps),
      frameToTime(29n, fps),
      frameToTime(30n, fps),
    ];
    expect(times.map((t) => sequenceContains(sequence, t))).toEqual([false, true, true, false]);
    expect(
      times.map((t) => ({
        contains: sequenceContains(sequence, t),
        localTime: output(sequenceLocalTime(sequence, t)),
      })),
    ).toEqual(
      evalSpecs(
        times.map((t) => ({
          fn: 'Sequence.sample',
          args: { start: wire(sequence.start), end: wire(sequence.end), time: wire(t) },
        })),
      ),
    );
  });

  it('composes local time offsets without rounding subframe boundaries', () => {
    const parent = unwrap(createSequence(time(1, 3), time(2)));
    const nested = unwrap(createSequence(time(1, 7), time(1)));
    const global = unwrap(createSequence(addTime(parent.start, nested.start), time(1)));
    const t = time(5, 6);
    expect(sequenceLocalTime(nested, sequenceLocalTime(parent, t))).toEqual(
      sequenceLocalTime(global, t),
    );
    expect(createSequence(time(0), time(-1)).ok).toBe(false);
  });
});
