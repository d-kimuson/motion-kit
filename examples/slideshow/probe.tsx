import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { FlatSurface } from './slides/flat.tsx';
import { SLIDESHOW_FPS, probeSlides } from './slides/plan.ts';
import { SlideshowScene } from './slides/slides.tsx';

// The determinism gate's Composition (docs/design-doc/20261025-reference-examples.md, "CI policy"):
// 480x270 for 30 frames — a `TransitionSeries` crossfade plus the width/height layout read, from the
// same `SlideshowScene` the full example renders, with flat surfaces instead of the `useAsset` photos
// (the recorded image-in-a-Sequence race keeps media out of the probes). A separate registry keeps it
// out of what a reader renders, and its props schema is empty because the suite passes a flat record.
export const compositions = defineCompositions([
  defineComposition({
    id: 'slideshow-probe',
    width: 480,
    height: 270,
    fps: { numerator: SLIDESHOW_FPS, denominator: 1 },
    durationInFrames: 30,
    schema: z.object({}),
    component: () => (
      <SlideshowScene assetSet="placeholder" slides={probeSlides} surface={FlatSurface} />
    ),
  }),
]);
