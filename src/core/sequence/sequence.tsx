import { useMemo, type ReactNode } from 'react';

import { type Result } from '../../lib/result.ts';
import { useCompositionFrame } from '../composition/composition.tsx';
import { addTime, createTimelineTime, type RationalInput } from '../timeline/time.ts';
import { SequenceIntervalContext, useSequenceInterval } from './context.ts';
import { createSequence, sequenceContains, type SequenceInterval } from './interval.ts';

export type SequenceProps = {
  /** Seconds relative to the enclosing Sequence start (or the Composition start). */
  from: number | RationalInput;
  /** Nonnegative seconds. Zero duration renders no children. */
  duration: number | RationalInput;
  children: ReactNode;
};

// Invalid authored JSX is a programmer error; the Composition boundary reports render.page-error.
const authored = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`Invalid Sequence: ${result.error.message}`);
  return result.value;
};

/** Render only within [start, end). Ancestors clip visibility, not the declared interval. */
export const Sequence = ({ from, duration, children }: SequenceProps) => {
  const parent = useSequenceInterval();
  const interval = useMemo(
    () =>
      authored(
        createSequence(
          addTime(parent.start, authored(createTimelineTime(from))),
          authored(createTimelineTime(duration)),
        ),
      ),
    [parent.start, from, duration],
  );
  return <AbsoluteSequence interval={interval}>{children}</AbsoluteSequence>;
};

/** Internal absolute-placement path shared by Sequence and TransitionSeries. */
export const AbsoluteSequence = ({
  interval,
  children,
}: {
  interval: SequenceInterval;
  children: ReactNode;
}) => {
  const { presentationTime } = useCompositionFrame();
  if (!sequenceContains(interval, presentationTime)) return null;
  return (
    <SequenceIntervalContext.Provider value={interval}>{children}</SequenceIntervalContext.Provider>
  );
};
