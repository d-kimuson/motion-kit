import { createContext, useContext } from 'react';

import { useCompositionDefinition } from '../composition/composition.tsx';
import { frameToTime, zeroTime } from '../timeline/time.ts';
import { type SequenceInterval } from './interval.ts';

/** Internal context stores exact global endpoints, never the lossy public hook values. */
export const SequenceIntervalContext = createContext<SequenceInterval | null>(null);

/** Named-ancestor path (unnamed Sequences add nothing) and what the ancestors leave visible. */
export type SequenceScope = Readonly<{ path: readonly string[]; visible: SequenceInterval }>;
export const SequenceScopeContext = createContext<SequenceScope | null>(null);

export const useSequenceInterval = (): SequenceInterval => {
  const interval = useContext(SequenceIntervalContext);
  const { descriptor, frameRate } = useCompositionDefinition();
  return (
    interval ?? {
      start: zeroTime,
      end: frameToTime(BigInt(descriptor.durationInFrames), frameRate),
    }
  );
};
