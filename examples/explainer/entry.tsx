// The explainer's two Compositions. Both render the same `ExplainerScene`; only the storyboard, the
// size and the length differ, and `explainer-ci` is the disclaimer slide plus one dialogue line plus
// the crossfade between them, at half linear resolution for 60 frames.
//
// `durationInFrames` is derived from the script, never written by hand: `frameCount` of the script's
// own `totalSeconds` at 30 fps. Both Time Module calls return a `Result`, so both are unwrapped, and
// a script whose length changes moves the Composition with it.
import {
  createFrameRate,
  createTimelineTime,
  defineComposition,
  defineCompositions,
  frameCount,
  type Result,
} from '@kimuson/motion-kit';
import { z } from 'zod';

import { soundtrack } from './audio.ts';
import { ExplainerScene } from './ExplainerScene.tsx';
import { ciStoryboard, explainerStoryboard } from './plan.ts';
import { totalSeconds } from './script.ts';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`explainer: ${result.error.message}`);
  return result.value;
};

/** 30 fps: the design doc's rate for every example. */
export const fps = unwrap(createFrameRate({ numerator: 30, denominator: 1 }));
const fpsValue = Number(fps.numerator) / Number(fps.denominator);

/** The script's 222 s as 6660 frames: the video's whole length, derived at module load. */
export const durationInFrames = Number(
  unwrap(frameCount(unwrap(createTimelineTime(totalSeconds)), fps)),
);

/**
 * The one switch every media example carries: `placeholder` (the default, and what CI and every
 * commit-time render use) draws a badge for each character and the committed font; `final` draws
 * the portraits the local VOICEVOX engine ships. The voices are declared on the Composition either way, because audio is
 * descriptor data rather than a prop — `fetch-assets.ts` writes silent voice placeholders for step 1
 * and replaces them in step 2, so a placeholder render carries the music bed and the whoosh with no
 * voice rather than failing on a missing file.
 */
export const assetsProps = z.object({
  assets: z.enum(['placeholder', 'final']).default('placeholder'),
});

type ExplainerProps = z.infer<typeof assetsProps>;

/** Both Compositions read one storyboard each, built once at module load. */
export const storyboard = explainerStoryboard(fpsValue);
export const ci = ciStoryboard();

const Explainer = ({ assets }: ExplainerProps) => (
  <ExplainerScene storyboard={storyboard} assets={assets} flat={false} />
);

const ExplainerCi = ({ assets }: ExplainerProps) => (
  <ExplainerScene storyboard={ci} assets={assets} flat={false} />
);

/**
 * The entry holds two Compositions, so `--composition <id>` is always required. `explainer` is
 * 1920x1080 at 30 fps for 6660 frames (222 s); `explainer-ci` is 960x540 for 60 frames. Only the
 * full Composition declares audio: CI stays silent and needs no generated voice.
 */
export const compositions = defineCompositions([
  defineComposition({
    id: 'explainer',
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames,
    schema: assetsProps,
    component: Explainer,
    audio: soundtrack(storyboard),
  }),
  defineComposition({
    id: 'explainer-ci',
    width: 960,
    height: 540,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: ci.durationInFrames,
    schema: assetsProps,
    component: ExplainerCi,
  }),
]);
