import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';

import { type Result } from '../../lib/result.ts';
import { useCompositionFrame } from '../composition/composition.tsx';
import { useSequenceInterval } from '../sequence/context.ts';
import { offsetSequence, type SequenceInterval } from '../sequence/interval.ts';
import { AbsoluteSequence } from '../sequence/sequence.tsx';
import { createTimelineTime, toSeconds, zeroTime, type RationalInput } from '../timeline/time.ts';
import { createTransitionSeries, sampleTransition } from './overlap.ts';

export type TransitionSeriesProps = { children?: ReactNode };
export type TransitionSceneProps = {
  duration: number | RationalInput;
  /** Same contract as `SequenceProps.name`. */
  name?: string;
  children: ReactNode;
};
export type TransitionProps = {
  duration: number | RationalInput;
  children?: ReactNode;
};

const ProgressContext = createContext<number | null>(null);

/** Dimensionless overlap progress, converted to number only for expression code. */
export const useTransitionProgress = (): number => {
  const progress = useContext(ProgressContext);
  if (progress === null) throw new Error('useTransitionProgress requires an active Transition.');
  return progress;
};

/** Declaration consumed by TransitionSeries, not an independently placed scene. */
export const TransitionScene = (_props: TransitionSceneProps): ReactNode => {
  throw new Error('TransitionScene must be a direct child of TransitionSeries.');
};

/** Children mount only during the overlap and can read useTransitionProgress(). */
export const Transition = ({ children }: TransitionProps): ReactNode => {
  useTransitionProgress();
  return children;
};

// Invalid authored JSX is a programmer error; Composition reports render.page-error.
const authored = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`Invalid TransitionSeries: ${result.error.message}`);
  return result.value;
};

const declarations = (children: ReactNode) => {
  const scenes: ReactElement<TransitionSceneProps>[] = [];
  const transitions: (ReactElement<TransitionProps> | null)[] = [];
  let pending: ReactElement<TransitionProps> | null = null;
  for (const child of Children.toArray(children)) {
    if (isValidElement<TransitionSceneProps>(child) && child.type === TransitionScene) {
      if (scenes.length > 0) transitions.push(pending);
      scenes.push(child);
      pending = null;
    } else if (
      isValidElement<TransitionProps>(child) &&
      child.type === Transition &&
      scenes.length > 0 &&
      pending === null
    ) {
      pending = child;
    } else {
      throw new Error(
        'Invalid TransitionSeries: use direct TransitionScene children with at most one Transition between adjacent scenes.',
      );
    }
  }
  if (pending !== null)
    throw new Error(
      'Invalid TransitionSeries: a Transition must be followed by a TransitionScene.',
    );
  const timing = authored(
    createTransitionSeries(
      scenes.map(({ props }) => authored(createTimelineTime(props.duration))),
      transitions.map((child) =>
        child === null ? zeroTime : authored(createTimelineTime(child.props.duration)),
      ),
    ),
  );
  return { scenes, transitions, timing };
};

const Overlap = ({ interval, children }: { interval: SequenceInterval; children: ReactNode }) => {
  const { presentationTime } = useCompositionFrame();
  const sample = sampleTransition(interval, presentationTime);
  if (!sample.active) return null;
  return (
    <AbsoluteSequence interval={interval}>
      <ProgressContext.Provider value={toSeconds(sample.progress)}>
        {children}
      </ProgressContext.Provider>
    </AbsoluteSequence>
  );
};

/** Lay out scenes with exact pure timing; adjacent scenes without a Transition use a hard cut. */
export const TransitionSeries = ({ children }: TransitionSeriesProps) => {
  const parent = useSequenceInterval();
  const { scenes, transitions, timing } = useMemo(() => declarations(children), [children]);
  return (
    <>
      {scenes.map((scene, index) => {
        const interval = timing.scenes[index];
        if (interval === undefined) throw new Error('Missing scene timing.');
        return (
          <AbsoluteSequence
            key={scene.key}
            interval={offsetSequence(interval, parent.start)}
            name={scene.props.name}
          >
            {scene.props.children}
          </AbsoluteSequence>
        );
      })}
      {transitions.map((transition, index) => {
        if (transition === null) return null;
        const interval = timing.transitions[index];
        if (interval === undefined) throw new Error('Missing transition timing.');
        return (
          <Overlap key={transition.key} interval={offsetSequence(interval, parent.start)}>
            {transition}
          </Overlap>
        );
      })}
    </>
  );
};
