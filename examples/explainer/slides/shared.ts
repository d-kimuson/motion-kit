// The one switch every layer reads: whether this tree is the probe's flat stand-in.
import { createContext, useContext } from 'react';

/**
 * Whether this tree is the probe's flat stand-in (`ExplainerScene`'s `flat`). The stand-in does not
 * fade anything: `SlideSeries` swaps the scene for `FlatSlide` and the crossfade for a discrete
 * switch at the overlap's first frame, and the other layers draw their own flat surfaces, so a probe
 * frame is a pure function of the frame index over opaque integer rectangles (`../flat.tsx`). The
 * real compositions never set it, so their motion is untouched.
 */
const Flat = createContext(false);

/** What the layers read; `ExplainerScene` provides it once for the whole tree. */
export const FlatMode = Flat.Provider;

export const useFlat = (): boolean => useContext(Flat);
