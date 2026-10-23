import { type Result } from '../../lib/result.ts';
import { sequenceContains, type SequenceInterval } from '../sequence/interval.ts';
import {
  addTime,
  compareTime,
  divideTime,
  oneTime,
  subtractTime,
  timeFailure,
  zeroTime,
  type TimelineTime,
} from '../timeline/time.ts';

/** Exact placement only; scene content and visual effects belong to the runtime and presets. */
export type TransitionSeriesTiming = {
  readonly scenes: readonly SequenceInterval[];
  readonly transitions: readonly SequenceInterval[];
  readonly duration: TimelineTime;
};

export type TransitionSample = { readonly active: boolean; readonly progress: TimelineTime };

/** There must be one overlap per adjacent pair; equality with either scene duration is allowed. */
export const createTransitionSeries = (
  durations: readonly TimelineTime[],
  overlaps: readonly TimelineTime[],
): Result<TransitionSeriesTiming> => {
  if (overlaps.length !== Math.max(0, durations.length - 1)) {
    return timeFailure(
      'Transition overlaps must match the adjacent scene pairs.',
      'Supply exactly one overlap per adjacent pair, or none for an empty or singleton series.',
      'composition.duration-invalid',
    );
  }
  if (durations.some((duration) => duration.numerator < 0n)) {
    return timeFailure(
      'Scene duration must be nonnegative.',
      'Supply zero or positive scene durations.',
      'composition.duration-invalid',
    );
  }
  for (const [index, overlap] of overlaps.entries()) {
    const left = durations[index];
    const right = durations[index + 1];
    if (
      left === undefined ||
      right === undefined ||
      overlap.numerator < 0n ||
      compareTime(overlap, left) > 0 ||
      compareTime(overlap, right) > 0
    ) {
      return timeFailure(
        'Transition overlap exceeds its adjacent scenes or is negative.',
        'Supply an overlap between zero and the smaller adjacent scene duration, inclusive.',
        'composition.duration-invalid',
      );
    }
  }
  const scenes: SequenceInterval[] = [];
  const transitions: SequenceInterval[] = [];
  let start = zeroTime;
  for (const [index, duration] of durations.entries()) {
    const end = addTime(start, duration);
    scenes.push(Object.freeze({ start, end }));
    const overlap = overlaps[index];
    if (overlap !== undefined) {
      start = subtractTime(end, overlap);
      transitions.push(Object.freeze({ start, end }));
    } else {
      start = end;
    }
  }
  return {
    ok: true,
    value: Object.freeze({
      scenes: Object.freeze(scenes),
      transitions: Object.freeze(transitions),
      duration: start,
    }),
  };
};

/** A zero overlap is never active; progress jumps from zero to one at its start. */
export const sampleTransition = (
  transition: SequenceInterval,
  time: TimelineTime,
): TransitionSample => ({
  active: sequenceContains(transition, time),
  progress:
    compareTime(time, transition.start) < 0
      ? zeroTime
      : compareTime(time, transition.end) >= 0
        ? oneTime
        : divideTime(
            subtractTime(time, transition.start),
            subtractTime(transition.end, transition.start),
          ),
});
