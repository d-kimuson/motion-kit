import { type Result } from '../../lib/result.ts';
import {
  addTime,
  compareTime,
  subtractTime,
  timeFailure,
  type TimelineTime,
} from '../timeline/time.ts';

/** A validated half-open Sequence interval; a zero duration is an empty interval. */
export type SequenceInterval = { readonly start: TimelineTime; readonly end: TimelineTime };

export const createSequence = (
  start: TimelineTime,
  duration: TimelineTime,
): Result<SequenceInterval> => {
  if (duration.numerator < 0n) {
    return timeFailure(
      'Sequence duration must be nonnegative.',
      'Supply a zero or positive sequence duration.',
      'composition.duration-invalid',
    );
  }
  return { ok: true, value: Object.freeze({ start, end: addTime(start, duration) }) };
};

/** Derived from Sequence.contains: no conversion to seconds or integer frames occurs here. */
export const sequenceContains = (sequence: SequenceInterval, time: TimelineTime): boolean =>
  compareTime(sequence.start, time) <= 0 && compareTime(time, sequence.end) < 0;

/** Signed local time remains defined outside membership for pure, seekable evaluation. */
export const sequenceLocalTime = (sequence: SequenceInterval, time: TimelineTime): TimelineTime =>
  subtractTime(time, sequence.start);
