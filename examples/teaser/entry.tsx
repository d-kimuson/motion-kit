import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { teaserCiWords, teaserWords } from './copy.ts';
import { TeaserScene } from './scenes.tsx';

// No props: the teaser's words are a module constant (copy.ts), so `--props` has nothing to say.
const teaserProps = z.object({});

const Teaser = () => <TeaserScene words={teaserWords} />;
const TeaserCi = () => <TeaserScene words={teaserCiWords} />;

/** The entry holds two Compositions, so `--composition <id>` is always required. `teaser` is
 * 1920x1080 at 30 fps for 720 frames (24 s, inside the design doc's 450–900); `teaser-ci` is half
 * linear resolution for 60 frames and renders the opening word plus the first two transitions. */
export const compositions = defineCompositions([
  defineComposition({
    id: 'teaser',
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 720,
    schema: teaserProps,
    component: Teaser,
  }),
  defineComposition({
    id: 'teaser-ci',
    width: 960,
    height: 540,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 60,
    schema: teaserProps,
    component: TeaserCi,
  }),
]);
