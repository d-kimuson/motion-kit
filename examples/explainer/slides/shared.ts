// What every slide shares: its props, its local time, and the opacity-only reveal.
//
// A slide is a pure function of its cue and its local time, so the scene render and the crossfade's
// overlay draw the same thing: the overlay hands the outgoing slide the time its own scene would be
// at (its content ends where the overlap begins), and the incoming slide reads the 0..0.4 s its own
// scene starts with. Nothing jumps at either edge of a crossfade.
import { useTime } from '@kimuson/motion-kit';
import { createContext, useContext } from 'react';

import { clamp01 } from '../look.ts';
import { type PlannedSlide } from '../plan.ts';

export type SlideProps = {
  readonly slide: PlannedSlide;
  /**
   * Seconds since this slide's own zero. Omitted inside the slide's own `TransitionScene`, where the
   * enclosing `Sequence` already reports exactly that; set by the crossfade overlay, whose own time
   * belongs to the incoming slide.
   */
  readonly time?: number;
};

/** How long an element takes to arrive once its own delay has passed. */
const revealSeconds = 0.32;

export const useSlideTime = (given?: number): number => {
  const own = useTime();
  return given ?? own;
};

/**
 * `reveal(delay)` is 0 before `delay`, 1 after it, and linear in between, read from the slide's own
 * local time. Nothing translates: the teaser records that a `transform` on a glyph run made Chromium
 * rasterise the same frame differently between paints, so an arrival here is opacity only.
 */
export type Reveal = (delaySeconds: number) => number;

/**
 * Whether this tree is the probe's flat stand-in (`ExplainerScene`'s `flat`). The stand-in drops the
 * opacity ramp as well as the media: an element whose opacity settles on 1 is painted through the
 * layer it promoted while it was translucent, and the same frame painted cold uses the direct path,
 * so the two disagree by a few hundred glyph pixels. The gate met exactly that at `explainer-probe`
 * frame 29 in six of the seven traversal modes — the same class as the flattened sprite panel the
 * probe already draws — and the probe watches the layer structure and the timing, not the curve.
 */
const Flat = createContext(false);

/** What `useSlideReveal` reads; `ExplainerScene` provides it once for the whole tree. */
export const FlatMode = Flat.Provider;

export const useSlideReveal = (time: number): Reveal => {
  const flat = useContext(Flat);
  return (delaySeconds) => (flat ? 1 : clamp01((time - delaySeconds) / revealSeconds));
};

/** The left column every slide's text lives in: clear of the sprites at the lower corners. */
export const textColumn = (width: number) => ({
  left: Math.round(width * 0.075),
  width: Math.round(width * 0.72),
});
