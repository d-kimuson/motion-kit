import { type SequenceSpan } from '../../lib/loading-protocol.ts';
import { compareTime, timeToFrameCeil, type FrameRate } from '../timeline/time.ts';
import { type SequenceInterval } from './interval.ts';

/** A named Sequence the mounted tree renders: its named-ancestor path and visible interval. */
export type NamedSequence = Readonly<{ path: readonly string[]; interval: SequenceInterval }>;

/** Intersect a child with what its ancestors show; a disjoint child is empty at the clip start. */
export const clipSequence = (
  sequence: SequenceInterval,
  clip: SequenceInterval,
): SequenceInterval => {
  const start = compareTime(sequence.start, clip.start) < 0 ? clip.start : sequence.start;
  const end = compareTime(sequence.end, clip.end) > 0 ? clip.end : sequence.end;
  return Object.freeze({ start, end: compareTime(end, start) < 0 ? start : end });
};

/** Mutable registrations owned by one Composition runtime; the tree registers in layout effects. */
export const createSequenceDirectory = () => {
  const entries = new Set<NamedSequence>();
  return {
    register: (entry: NamedSequence): (() => void) => {
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    entries: (): readonly NamedSequence[] => [...entries],
  };
};

const comparePath = (a: readonly string[], b: readonly string[]): number => {
  const joined = (path: readonly string[]) => path.join('\u0000');
  return a.length - b.length || (joined(a) < joined(b) ? -1 : joined(a) > joined(b) ? 1 : 0);
};

/**
 * Frame f shows the Sequence when start <= f / fps < end, so both endpoints round up through the
 * Time Module. Spans are not clamped to the Composition duration, matching Sequence placement.
 */
export const sequenceSpans = (
  entries: readonly NamedSequence[],
  fps: FrameRate,
): readonly SequenceSpan[] =>
  entries
    .map(({ path, interval }) => ({
      path: [...path],
      startFrame: Number(timeToFrameCeil(interval.start, fps)),
      endFrame: Number(timeToFrameCeil(interval.end, fps)),
    }))
    .sort((a, b) => a.startFrame - b.startFrame || comparePath(a.path, b.path));

/** Named Sequences showing at a frame, outer before inner, in `sequenceSpans` order. */
export const activeSequences = (
  spans: readonly SequenceSpan[],
  frame: number,
): readonly SequenceSpan[] =>
  spans.filter(({ startFrame, endFrame }) => startFrame <= frame && frame < endFrame);
