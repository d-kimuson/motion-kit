import { type SequenceSpan } from '../../lib/loading-protocol.ts';
import {
  compareTime,
  timeToFrameCeil,
  type FrameRate,
  type TimelineTime,
} from '../timeline/time.ts';
import { type SequenceInterval } from './interval.ts';

/** A named Sequence the mounted tree renders: its named-ancestor path and visible interval. */
export type NamedSequence = Readonly<{ path: readonly string[]; interval: SequenceInterval }>;

const later = (a: TimelineTime, b: TimelineTime) => (compareTime(a, b) < 0 ? b : a);
const earlier = (a: TimelineTime, b: TimelineTime) => (compareTime(a, b) > 0 ? b : a);

/** Intersect a child with what its ancestors show; a disjoint child is empty at the nearer edge. */
export const clipSequence = (
  sequence: SequenceInterval,
  clip: SequenceInterval,
): SequenceInterval => {
  const start = earlier(later(sequence.start, clip.start), clip.end);
  return Object.freeze({ start, end: later(earlier(sequence.end, clip.end), start) });
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

// Outer before inner, then segment by segment; a name may contain any character.
const comparePath = (a: readonly string[], b: readonly string[]): number => {
  if (a.length !== b.length) return a.length - b.length;
  for (const [index, segment] of a.entries()) {
    const other = b[index] ?? '';
    if (segment !== other) return segment < other ? -1 : 1;
  }
  return 0;
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
    // A total order on the reported values, so registration (effect) order never shows. Siblings
    // may share a name; spans equal in every field are indistinguishable.
    .sort(
      (a, b) =>
        a.startFrame - b.startFrame || comparePath(a.path, b.path) || a.endFrame - b.endFrame,
    );

/** Named Sequences showing at a frame, outer before inner, in `sequenceSpans` order. */
export const activeSequences = (
  spans: readonly SequenceSpan[],
  frame: number,
): readonly SequenceSpan[] =>
  spans.filter(({ startFrame, endFrame }) => startFrame <= frame && frame < endFrame);
