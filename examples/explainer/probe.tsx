// The determinism gate's Composition (docs/design-doc/20261025-reference-examples.md, "CI policy"):
// the same three layers, the same crossfade and the same storyboard shape at 480x270 for 30 frames.
//
// It replaces the media steps with flat surfaces — no font, no sprite image — because an image
// `useAsset` inside a `Sequence` is the construct the design doc records as an intermittent
// determinism failure. The probe therefore watches the layer structure and the timing, not the
// media, and its props schema is empty because `DeterminismComposition.props` is a flat record.
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
