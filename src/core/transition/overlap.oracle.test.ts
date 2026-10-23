import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { evalSpec, evalSpecs } from '../../../spec/oracle.ts';
import { type Result } from '../../lib/result.ts';
import { sequenceContains, sequenceLocalTime } from '../sequence/interval.ts';
import { addTime, createTimelineTime, type TimelineTime } from '../timeline/time.ts';
import { createTransitionSeries, sampleTransition } from './overlap.ts';

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

const inputs = fc.record({
  left: fc.nat(1000),
  right: fc.nat(1000),
  denominator: fc.integer({ min: 1, max: 1001 }),
  pick: fc.nat(1000),
});

describe('Transition overlap', () => {
  it('matches Lean at zero, partial, and full adjacent-scene overlap', () => {
    fc.assert(
      fc.property(fc.array(inputs, { minLength: 10, maxLength: 10 }), (batch) => {
        const cases = batch.flatMap(({ left, right, denominator, pick }) => {
          const maximum = Math.min(left, right);
          return [0, maximum, pick % (maximum + 1)].flatMap((overlap) => {
            const a = time(left, denominator);
            const b = time(right, denominator);
            const o = time(overlap, denominator);
            const series = unwrap(createTransitionSeries([a, b], [o]));
            const transition = series.transitions[0];
            const first = series.scenes[0];
            const second = series.scenes[1];
            if (transition === undefined || first === undefined || second === undefined)
              throw new Error('missing pair');
            const times = [
              time(left - overlap - 1, denominator),
              transition.start,
              time(2 * left - overlap, 2 * denominator),
              transition.end,
              addTime(transition.end, time(1, denominator)),
            ];
            return times.map((t) => {
              const sample = sampleTransition(transition, t);
              expect(!sample.active || sequenceContains(first, t)).toBe(true);
              expect(!sample.active || sequenceContains(second, t)).toBe(true);
              expect(sequenceLocalTime(first, t)).toEqual(t);
              return {
                args: { left: wire(a), right: wire(b), overlap: wire(o), time: wire(t) },
                actual: {
                  valid: true,
                  start: output(second.start),
                  duration: output(series.duration),
                  active: sample.active,
                  progress: output(sample.progress),
                },
              };
            });
          });
        });
        expect(cases.map((entry) => entry.actual)).toEqual(
          evalSpecs(cases.map(({ args }) => ({ fn: 'Transition.sample', args }))),
        );
      }),
      { numRuns: 10 },
    );
  });

  it('matches the exact series sum, including empty and singleton series', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.array(fc.nat(1000), { maxLength: 12 }), fc.nat(1000)), {
          minLength: 10,
          maxLength: 10,
        }),
        (batch) => {
          const cases = batch.flatMap(([values, pick]) => {
            const scenes = values.map((value) => time(value, 1001));
            const overlaps = values
              .slice(1)
              .map((value, index) => time(pick % (Math.min(values[index] ?? 0, value) + 1), 1001));
            const series = unwrap(createTransitionSeries(scenes, overlaps));
            const args = { scenes: scenes.map(wire), overlaps: overlaps.map(wire) };
            expect(series.scenes.at(-1)?.end ?? time(0)).toEqual(series.duration);
            return [
              { fn: 'Transition.totalDuration', args, actual: output(series.duration) },
              {
                fn: 'Transition.layout',
                args,
                actual: series.scenes.map((scene) => ({
                  start: output(scene.start),
                  end: output(scene.end),
                })),
              },
            ];
          });
          expect(cases.map((entry) => entry.actual)).toEqual(
            evalSpecs(cases.map(({ fn, args }) => ({ fn, args }))),
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  it('rejects negative durations, invalid arity, and excessive overlaps', () => {
    for (const overlap of [-1, 3]) {
      const o = time(overlap);
      const result = createTransitionSeries([time(1), time(2)], [o]);
      expect(result.ok).toBe(false);
      const oracle = evalSpec('Transition.sample', {
        left: wire(time(1)),
        right: wire(time(2)),
        overlap: wire(o),
        time: wire(time(0)),
      });
      expect(oracle).toMatchObject({ valid: false });
    }
    expect(createTransitionSeries([time(-1)], []).ok).toBe(false);
    expect(createTransitionSeries([], [time(0)]).ok).toBe(false);
    expect(createTransitionSeries([time(1), time(1)], []).ok).toBe(false);
    expect(unwrap(createTransitionSeries([], []))).toEqual({
      scenes: [],
      transitions: [],
      duration: time(0),
    });
  });
});
