import { type Seekability } from '../core/runtime/composition-runtime.ts';

/** A canvas is never Tier A: the R3F/WebGL expression still needs integration settlement. */
export type CanvasSeekability = Exclude<Seekability, 'A'>;

/** Classify a canvas from the number of `useFrame` subscribers on its R3F root.
 *
 * No subscriber means every scene value is written from motion-kit time (Tier B). Any
 * subscriber is a callback motion-kit did not write and cannot distinguish from a
 * delta-integrating one, so the canvas is Tier C (`seek.uncontrolled`) rather than assumed
 * seekable because its root advances manually.
 */
export const classifyCanvas = (useFrameSubscriberCount: number): CanvasSeekability =>
  useFrameSubscriberCount === 0 ? 'B' : 'C';
