// The explainer's tree: five layers over the same storyboard, drawn in one 1920x1080 design space.
//
//   background  the ground, the drifting grid and lights, the stage panel
//   slides      a TransitionSeries of the script's scenes, 0.4 s handoffs
//   chrome      the title and the chapter progress along the top
//   speakers    both characters in the side lanes, the speaker lit
//   subtitles   one Sequence per sentence, in the box under the stage
//
// The design space is scaled to the Composition's own size once, here, so the CI twin at 960x540 is
// the same picture at half size. The probe's flat tree is not scaled: it draws opaque rectangles
// whose coordinates are scaled and rounded instead (`flat.tsx`), so no edge is ever resampled.
//
// The font is loaded once here, in a local `Suspense` inside the tree, because a throw that reaches
// the root Suspense keeps the Composition's own content acknowledgement from happening and the
// readiness barrier waits until its deadline (docs/design-doc/20261025-reference-examples.md). The
// variable face is registered once per weight the video sets, because the loader's readiness check
// asks for one weight at a time.
import { useAsset, useTimeline } from '@kimuson/motion-kit';
import { Suspense, type ReactNode } from 'react';

import { Background } from './Background.tsx';
import { Chrome } from './Chrome.tsx';
import {
  DESIGN,
  FONT_FAMILY,
  FONT_SOURCE,
  FONT_STACK,
  FONT_WEIGHTS,
  palette,
  type AssetsMode,
} from './look.ts';
import { type Storyboard } from './plan.ts';
import { script } from './script.ts';
import { FlatMode } from './slides/shared.ts';
import { SlideSeries } from './slides/SlideSeries.tsx';
import { Speakers } from './Speakers.tsx';
import { Subtitles } from './Subtitles.tsx';

/** One weight of the face. `text` is what `document.fonts.check` probes: kana, a kanji, a Latin letter. */
const FontWeight = ({ weight }: { readonly weight: number }) => {
  useAsset({
    kind: 'font',
    id: `noto-sans-jp-${String(weight)}`,
    family: FONT_FAMILY,
    source: FONT_SOURCE,
    weight,
    style: 'normal',
    text: 'あア亜A1',
  });
  return null;
};

const FontGate = ({ children }: { readonly children: ReactNode }) => (
  <>
    {FONT_WEIGHTS.map((weight) => (
      <FontWeight key={weight} weight={weight} />
    ))}
    {children}
  </>
);

const Layers = ({
  storyboard,
  assets,
}: {
  readonly storyboard: Storyboard;
  readonly assets: AssetsMode;
}) => (
  <>
    <Background />
    <SlideSeries storyboard={storyboard} />
    <Chrome storyboard={storyboard} title={script.title} />
    <Speakers storyboard={storyboard} assets={assets} />
    <Subtitles storyboard={storyboard} />
  </>
);

export type ExplainerSceneProps = {
  readonly storyboard: Storyboard;
  readonly assets: AssetsMode;
  /**
   * Replace every paint the platform rasterises its own way with a flat surface — no font, no
   * portrait, no gradient, no fresh paint every frame: opaque integer rectangles only (`flat.tsx`).
   * Only `probe.tsx` sets it, because the determinism gate compares PNG bytes across platforms and a
   * glyph, a fractional alpha, an antialiased corner and an image each rasterise differently there.
   * The layers, their `Sequence`s and the `TransitionSeries` overlap are the same tree either way.
   */
  readonly flat: boolean;
};

export const ExplainerScene = ({ storyboard, assets, flat }: ExplainerSceneProps) => {
  const { width } = useTimeline();
  if (flat)
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background: palette.groundTop,
        }}
      >
        <FlatMode value>
          <Layers storyboard={storyboard} assets={assets} />
        </FlatMode>
      </div>
    );
  return (
    <div
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: palette.groundTop }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: DESIGN.width,
          height: DESIGN.height,
          transformOrigin: '0 0',
          transform: width === DESIGN.width ? undefined : `scale(${String(width / DESIGN.width)})`,
          color: palette.text,
          fontFamily: FONT_STACK,
        }}
      >
        <Suspense fallback={null}>
          <FontGate>
            <FlatMode value={false}>
              <Layers storyboard={storyboard} assets={assets} />
            </FlatMode>
          </FontGate>
        </Suspense>
      </div>
    </div>
  );
};
