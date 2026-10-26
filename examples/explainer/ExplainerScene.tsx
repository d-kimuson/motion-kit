// The explainer's tree: three layers over the same storyboard, and the committed face they draw in.
//
//   slides     a TransitionSeries of the script's slide cues, 0.4 s crossfades
//   sprites    one Sequence per line, both characters, speaker lit and mouthing
//   subtitles  one Sequence per line, the subtitle band on top
//
// The font is loaded once here, in a local `Suspense` inside the tree, because a throw that reaches
// the root Suspense keeps the Composition's own content acknowledgement from happening and the
// readiness barrier waits until its deadline (docs/design-doc/20261025-reference-examples.md).
import { useAsset } from '@kimuson/motion-kit';
import { Suspense, type ReactNode } from 'react';

import { FONT_FAMILY, FONT_SOURCE, FONT_STACK, GROUND, INK, type AssetsMode } from './look.ts';
import { type Storyboard } from './plan.ts';
import { SlideSeries } from './slides/SlideSeries.tsx';
import { Sprites } from './Sprites.tsx';
import { Subtitles } from './Subtitles.tsx';

/**
 * The face: Noto Sans JP, shipped with its OFL text. `text` is what `document.fonts.check` probes, so
 * it names kana, a kanji and a Latin letter — the three scripts the video draws.
 */
const FontGate = ({ children }: { readonly children: ReactNode }) => {
  useAsset({
    kind: 'font',
    id: 'noto-sans-jp',
    family: FONT_FAMILY,
    source: FONT_SOURCE,
    weight: 400,
    style: 'normal',
    text: 'あア亜A1',
  });
  return children;
};

const Layers = ({ storyboard, assets, flat }: ExplainerSceneProps) => (
  <>
    <SlideSeries storyboard={storyboard} />
    <Sprites storyboard={storyboard} assets={assets} flat={flat} />
    <Subtitles storyboard={storyboard} assets={assets} />
  </>
);

export type ExplainerSceneProps = {
  readonly storyboard: Storyboard;
  readonly assets: AssetsMode;
  /**
   * Replace every media step with a flat surface: no font, no sprite image. Only `probe.tsx` sets
   * it, because an image `useAsset` inside a `Sequence` is the construct the design doc records as
   * an intermittent determinism failure, so the gate watches the structure without the media.
   */
  readonly flat: boolean;
};

export const ExplainerScene = ({ storyboard, assets, flat }: ExplainerSceneProps) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      background: GROUND,
      color: INK,
      fontFamily: FONT_STACK,
    }}
  >
    {flat ? (
      <Layers storyboard={storyboard} assets={assets} flat />
    ) : (
      <Suspense fallback={null}>
        <FontGate>
          <Layers storyboard={storyboard} assets={assets} flat={false} />
        </FontGate>
      </Suspense>
    )}
  </div>
);
