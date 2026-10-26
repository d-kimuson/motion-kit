import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { teaserCiWords } from './copy.ts';
import { TeaserScene } from './scenes.tsx';

// The determinism gate's Composition (docs/design-doc/20261025-reference-examples.md, "CI policy"):
// 480x270 for 30 frames — the opening word plus the first two transitions, from the same scene
// components the full teaser renders. A separate registry keeps it out of what a reader renders, and
// its props schema is empty because the suite passes a flat record and the teaser needs none.
export const compositions = defineCompositions([
  defineComposition({
    id: 'teaser-probe',
    width: 480,
    height: 270,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 30,
    schema: z.object({}),
    component: () => <TeaserScene words={teaserCiWords} />,
  }),
]);
