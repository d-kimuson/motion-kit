// The determinism gate's Composition (docs/design-doc/20261025-reference-examples.md, "CI policy"):
// the same three layers and the same storyboard shape at 480x270 for 30 frames, drawn flat.
//
// The gate compares PNG bytes with no tolerance, on this machine and on the Linux runner, so the
// probe may draw only what rasterises identically on both: solid, fully opaque, integer-pixel
// rectangles with square corners (`flat.tsx`, `slides/FlatSlide.tsx`). It keeps the real structural
// axis — the `TransitionSeries` overlap, one `Sequence` per line in two layers, the cue-driven slide
// shape — and drops every media and paint step: no font, no sprite image, no glyph, no fractional
// alpha, no antialiased edge, no animation of a paint property. Its props schema is empty because
// `DeterminismComposition.props` is a flat record.
import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { ExplainerScene } from './ExplainerScene.tsx';
import { probeStoryboard } from './plan.ts';

const board = probeStoryboard();

export const compositions = defineCompositions([
  defineComposition({
    id: 'explainer-probe',
    width: 480,
    height: 270,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: board.durationInFrames,
    schema: z.object({}),
    component: () => <ExplainerScene storyboard={board} assets="placeholder" flat />,
  }),
]);
