import { useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';

import { type Result } from '../../lib/result.ts';
import { useCompositionFrame, useCompositionRuntime } from '../composition/composition.tsx';
import { addTime, createTimelineTime, type RationalInput } from '../timeline/time.ts';
import {
  SequenceIntervalContext,
  SequenceScopeContext,
  useSequenceInterval,
  type SequenceScope,
} from './context.ts';
import { clipSequence } from './directory.ts';
import { createSequence, sequenceContains, type SequenceInterval } from './interval.ts';

export type SequenceProps = {
  /** Seconds relative to the enclosing Sequence start (or the Composition start). */
  from: number | RationalInput;
  /** Nonnegative seconds. Zero duration renders no children. */
  duration: number | RationalInput;
  /**
   * Nonempty label a host reads for this span through `sequences()`. Nested names
   * form a path; unnamed Sequences add no segment. Rendering is the same with or without it.
   */
  name?: string;
  children: ReactNode;
};

// Invalid authored JSX is a programmer error; the Composition boundary reports render.page-error.
const authored = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`Invalid Sequence: ${result.error.message}`);
  return result.value;
};

/** Render only within [start, end). Ancestors clip visibility, not the declared interval. */
export const Sequence = ({ from, duration, name, children }: SequenceProps) => {
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
  return (
    <AbsoluteSequence interval={interval} name={name}>
      {children}
    </AbsoluteSequence>
  );
};

/** Internal absolute-placement path shared by Sequence and TransitionSeries. */
export const AbsoluteSequence = ({
  interval,
  name,
  children,
}: {
  interval: SequenceInterval;
  name?: string | undefined;
  children: ReactNode;
}) => {
  const runtime = useCompositionRuntime();
  const parent = useContext(SequenceScopeContext);
  const scope = useMemo(
    (): SequenceScope => ({
      path: name === undefined ? (parent?.path ?? []) : [...(parent?.path ?? []), name],
      visible: parent === null ? interval : clipSequence(interval, parent.visible),
    }),
    [parent, name, interval],
  );
  // Registered even while inactive, so a host learns every span its mounted parent declares.
  useLayoutEffect(
    () =>
      name === undefined
        ? undefined
        : runtime.registerSequence({ path: scope.path, interval: scope.visible }),
    [runtime, name, scope],
  );
  const { presentationTime } = useCompositionFrame();
  if (name === '') throw new Error('Invalid Sequence: name must be nonempty.');
  if (!sequenceContains(interval, presentationTime)) return null;
  return (
    <SequenceIntervalContext.Provider value={interval}>
      <SequenceScopeContext.Provider value={scope}>{children}</SequenceScopeContext.Provider>
    </SequenceIntervalContext.Provider>
  );
};
