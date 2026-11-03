import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { promoCiStoryboard, promoStoryboard, storyboardFrames } from './plan.ts';
import { PromoScene } from './PromoScene.tsx';

// No props: the promo's words are module constants (copy.ts), so `--props` has nothing to say.
const promoProps = z.object({});

const Promo = () => <PromoScene board={promoStoryboard} />;
const PromoCi = () => <PromoScene board={promoCiStoryboard} />;

/** The entry holds two Compositions, so `--composition <id>` is always required. `promo` is
 * 1920x1080 at 30 fps for 1068 frames (35.6 s); `promo-ci` is half linear resolution for 60 frames and
 * renders the opening scene, one handoff and the start of the code scene. Both durations are the
 * storyboard's own length, so the board and the declaration cannot disagree. */
export const compositions = defineCompositions([
  defineComposition({
    id: 'promo',
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: storyboardFrames(promoStoryboard),
    schema: promoProps,
    component: Promo,
  }),
  defineComposition({
    id: 'promo-ci',
    width: 960,
    height: 540,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: storyboardFrames(promoCiStoryboard),
    schema: promoProps,
    component: PromoCi,
  }),
]);
