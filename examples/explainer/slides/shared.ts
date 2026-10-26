// What every slide shares: its props, its local time, and the opacity-only reveal.
//
// A slide is a pure function of its cue and its local time, so the scene render and the crossfade's
// overlay draw the same thing: the overlay hands the outgoing slide the time its own scene would be
// at (its content ends where the overlap begins), and the incoming slide reads the 0..0.4 s its own
// scene starts with. Nothing jumps at either edge of a crossfade.
import { useTime } from '@kimuson/motion-kit';

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

export const useSlideReveal =
  (time: number): Reveal =>
  (delaySeconds: number) =>
    clamp01((time - delaySeconds) / revealSeconds);

/** The left column every slide's text lives in: clear of the sprites at the lower corners. */
export const textColumn = (width: number) => ({
  left: Math.round(width * 0.075),
  width: Math.round(width * 0.72),
});
