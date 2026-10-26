import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { SLIDESHOW_FPS, SLIDESHOW_FRAMES, slides } from './slides/plan.ts';
import { SlideshowCiScene, SlideshowScene } from './slides/slides.tsx';

// The one switch the design doc gives every media example: `placeholder` reads the generated files
// under `assets.local/`, `final` reads committed or fetched media under `assets/`. CI and every
// commit-time render take the default; the local QA render passes `--props '{"assets":"final"}'`.
const slideshowProps = z.object({
  assets: z.enum(['placeholder', 'final']).default('placeholder'),
});

type SlideshowProps = z.output<typeof slideshowProps>;

const Slideshow = ({ assets }: SlideshowProps) => (
  <SlideshowScene assetSet={assets} slides={slides} />
);

/** The entry holds three Compositions, so `--composition <id>` is always required.
 *
 * - `slideshow` is the target: 1080x1920 at 30 fps for 900 frames (30 s, inside the design doc's
 *   600–1200), eight slides with 0.5-second crossfades.
 * - `slideshow-landscape` renders the *same* scene components at 1920x1080 for the same 900 frames:
 *   every geometry value comes from `useTimeline().width/height`, so this is the aspect-switching
 *   axis and not a second implementation.
 * - `slideshow-ci` is half linear resolution for 60 frames and renders the first three slides.
 */
export const compositions = defineCompositions([
  defineComposition({
    id: 'slideshow',
    width: 1080,
    height: 1920,
    fps: { numerator: SLIDESHOW_FPS, denominator: 1 },
    durationInFrames: SLIDESHOW_FRAMES,
    schema: slideshowProps,
    component: Slideshow,
  }),
  defineComposition({
    id: 'slideshow-landscape',
    width: 1920,
    height: 1080,
    fps: { numerator: SLIDESHOW_FPS, denominator: 1 },
    durationInFrames: SLIDESHOW_FRAMES,
    schema: slideshowProps,
    component: Slideshow,
  }),
  defineComposition({
    id: 'slideshow-ci',
    width: 540,
    height: 960,
    fps: { numerator: SLIDESHOW_FPS, denominator: 1 },
    durationInFrames: 60,
    schema: slideshowProps,
    component: SlideshowCiScene,
  }),
]);
