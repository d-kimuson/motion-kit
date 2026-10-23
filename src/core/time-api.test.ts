import {
  createFrameRate,
  createSequence,
  createTimelineTime,
  createTransitionSeries,
  frameToTime,
  sampleTransition,
  sequenceContains,
  type Result,
} from 'motion-kit';
import { describe, expect, it } from 'vitest';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('root Time Module exports', () => {
  it('evaluates the same samples independently of traversal order', () => {
    const fps = unwrap(createFrameRate({ numerator: 30000, denominator: 1001 }));
    const start = unwrap(createTimelineTime({ numerator: 1, denominator: 3 }));
    const duration = unwrap(createTimelineTime(1));
    const sequence = unwrap(createSequence(start, duration));
    const series = unwrap(createTransitionSeries([duration, duration], [start]));
    const transition = series.transitions[0];
    if (transition === undefined) throw new Error('missing transition');
    const evaluate = (frame: bigint) => {
      const time = frameToTime(frame, fps);
      return {
        contained: sequenceContains(sequence, time),
        transition: sampleTransition(transition, time),
      };
    };
    const frames = [0n, 10n, 20n, 29n, 30n, 40n];
    const sequential = new Map(frames.map((frame) => [frame, evaluate(frame)]));
    for (const frame of [40n, 0n, 20n, 30n, 20n, 10n, 29n]) {
      expect(evaluate(frame)).toEqual(sequential.get(frame));
    }
  });
});
