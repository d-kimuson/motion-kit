import {
  Transition,
  TransitionScene,
  TransitionSeries,
  useAsset,
  useSequence,
  useTimeline,
  useTransitionProgress,
} from '@kimuson/motion-kit';
import { Suspense, type ReactNode, useMemo } from 'react';

import {
  type AssetSet,
  type KenBurns,
  type Slide,
  ciSlides,
  crossfadeProgress,
  directionOf,
  easeInCubic,
  easeOutCubic,
  kenBurns,
  layoutFor,
  photoSource,
  planSlides,
} from './plan.ts';

// The look: full-bleed photos, one dark ink for the scrim ground, white type with a soft shadow.
// Phase 2 replaces these with /theme tokens; the tree below does not change.
const INK = '#0b0b0d';
const CHALK = '#ffffff';
const FONT_STACK =
  "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";
const MONO_STACK = "'SF Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace";

/** What a slide's picture is drawn with. The probe substitutes a flat surface; see `flat.tsx`. */
export type SurfaceProps = Readonly<{
  readonly slide: Slide;
  /** Root-relative URL of the photo, resolved for the Composition's `assets` prop. */
  readonly source: string;
  readonly kenBurns: KenBurns;
}>;

export type Surface = (props: SurfaceProps) => ReactNode;

/** The picture itself: `useAsset` for an image, drawn full-bleed and cropped to the frame. It sits
 *  inside the slide's local `<Suspense>`, never the root one: a throw that reached the root would
 *  keep the Composition's content acknowledgement from ever happening. */
const PhotoSurface = ({ slide, source, kenBurns: move }: SurfaceProps) => {
  const image = useAsset({ kind: 'image', id: `photo-${slide.id}`, source });
  return (
    <img
      alt={slide.caption}
      src={image.src}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `translate(${move.offsetX * 100}%, ${move.offsetY * 100}%) scale(${move.scale})`,
      }}
    />
  );
};

/** The visible diagnostic a slide shows when its photo has not resolved: the id and the URL it is
 *  waiting on, so a missing file is attributable instead of a blank frame. A photo that fails
 *  outright does not land here — `useAsset` throws `asset.load-failed` naming the source and the
 *  render fails with that diagnostic. */
const PendingPhoto = ({ slide, source }: { readonly slide: Slide; readonly source: string }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      width: '100%',
      height: '100%',
      padding: '8%',
      boxSizing: 'border-box',
      textAlign: 'center',
      background: '#1b1b20',
      color: '#d7d7de',
      fontFamily: MONO_STACK,
      fontSize: 16,
      lineHeight: 1.4,
    }}
  >
    <div style={{ color: '#ff8a6a' }}>photo not loaded</div>
    <div>{slide.id}</div>
    <div style={{ opacity: 0.6, wordBreak: 'break-all' }}>{source}</div>
  </div>
);

type CaptionProps = Readonly<{
  readonly slide: Slide;
  readonly index: number;
  readonly total: number;
  readonly opacity: number;
}>;

/** The white type in the lower third. It is drawn from the slide's props, so the caption identifies
 *  the slide even while the photo behind it is still loading. Sizes come from
 *  `layoutFor(width, height)`, the one place the aspect is turned into a layout. */
const Caption = ({ slide, index, total, opacity }: CaptionProps) => {
  const { width, height } = useTimeline();
  const layout = layoutFor(width, height);
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.inset,
        bottom: layout.captionBottom,
        width: layout.captionWidth,
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(layout.captionSize * 0.3),
        opacity,
        fontFamily: FONT_STACK,
        color: CHALK,
      }}
    >
      <div
        style={{
          fontSize: layout.kickerSize,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          opacity: 0.75,
          textShadow: layout.shadow,
        }}
      >
        {`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}
      </div>
      <div
        style={{
          fontSize: layout.captionSize,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          textShadow: layout.shadow,
        }}
      >
        {slide.caption}
      </div>
    </div>
  );
};

type SlideFrameProps = Readonly<{
  readonly slide: Slide;
  readonly source: string;
  readonly index: number;
  readonly total: number;
  readonly surface: Surface;
  /** Ken Burns progress in this slide's own scene, 0..1. Omitted for a slide at rest. */
  readonly progress?: number;
  /** Layer and caption opacities, so the crossfade can dim each without touching the tree. */
  readonly layerOpacity?: number;
  readonly captionOpacity?: number;
}>;

/**
 * One slide: the Ken Burns picture plus its caption. The transform rides on the picture layer, never
 * on the layer that holds the type — a transform over a glyph run made Chromium rasterise the same
 * frame differently between paints in the teaser, and the determinism gate caught it there.
 *
 * Presentational: a caller decides what progress to show it at, so the same component serves its own
 * scene and the crossfade overlay and the two agree pixel for pixel.
 */
const SlideFrame = ({
  slide,
  source,
  index,
  total,
  surface: SurfaceComponent,
  progress,
  layerOpacity = 1,
  captionOpacity = 1,
}: SlideFrameProps) => {
  const { time, duration } = useSequence();
  const { width, height } = useTimeline();
  const layout = layoutFor(width, height);
  const position = progress ?? (duration > 0 ? time / duration : 1);
  const move = kenBurns(position, directionOf(index));
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: INK }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: layerOpacity,
          transform: `translate(${move.offsetX * 100}%, ${move.offsetY * 100}%) scale(${move.scale})`,
        }}
      >
        <Suspense fallback={<PendingPhoto slide={slide} source={source} />}>
          <SurfaceComponent slide={slide} source={source} kenBurns={move} />
        </Suspense>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: layout.scrimHeight,
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.5) 100%)',
        }}
      />
      <Caption slide={slide} index={index} total={total} opacity={captionOpacity} />
    </div>
  );
};

type CrossFadeProps = Readonly<{
  readonly outgoing: Readonly<{ slide: Slide; source: string; index: number; seconds: number }>;
  readonly incoming: Readonly<{ slide: Slide; source: string; index: number; seconds: number }>;
  readonly total: number;
  readonly crossfadeSeconds: number;
  readonly surface: Surface;
}>;

/**
 * The one shared crossfade: the pictures dissolve linearly (`1 - p`, `p`), so their opacities sum to
 * exactly 1 in every frame and the fade never dips, while the captions swap on the faster `p³` pair,
 * so two legible captions never sit on top of each other at half opacity. Each side's Ken Burns
 * progress continues from where its own scene had reached, so the move does not restart at the cut.
 */
const CrossFade = ({ outgoing, incoming, total, crossfadeSeconds, surface }: CrossFadeProps) => {
  const progress = useTransitionProgress();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SlideFrame
        slide={outgoing.slide}
        source={outgoing.source}
        index={outgoing.index}
        total={total}
        surface={surface}
        progress={crossfadeProgress(progress, 'outgoing', crossfadeSeconds, outgoing.seconds)}
        layerOpacity={1 - progress}
        captionOpacity={1 - easeOutCubic(progress)}
      />
      <SlideFrame
        slide={incoming.slide}
        source={incoming.source}
        index={incoming.index}
        total={total}
        surface={surface}
        progress={crossfadeProgress(progress, 'incoming', crossfadeSeconds, incoming.seconds)}
        layerOpacity={progress}
        captionOpacity={easeInCubic(progress)}
      />
    </div>
  );
};

type SlideshowSceneProps = Readonly<{
  readonly assetSet: AssetSet;
  readonly slides: readonly Slide[];
  /** Defaults to the `useAsset` photo surface; the probe passes a flat one. */
  readonly surface?: Surface;
}>;

/**
 * The slideshow: one `TransitionSeries`, one scene per slide, one 0.5-second crossfade between each
 * pair. The vertical `slideshow`, its 16:9 twin, its `-ci` Composition and its probe all render this
 * component — the slide count, the crossfade length and every geometry value come from the
 * Composition's own `durationInFrames`, `frameRate`, `width` and `height`, so nothing here is sized
 * for one aspect.
 */
export const SlideshowScene = ({ assetSet, slides: list, surface }: SlideshowSceneProps) => {
  const timeline = useTimeline();
  const { frameRate, durationInFrames } = timeline;
  const fps = Number(frameRate.numerator) / Number(frameRate.denominator);
  const plan = useMemo(
    () => planSlides(durationInFrames, list.length, fps),
    [durationInFrames, list.length, fps],
  );
  const at = (frames: number) => ({
    numerator: frames * Number(frameRate.denominator),
    denominator: Number(frameRate.numerator),
  });
  const crossfadeSeconds = plan.crossfadeFrames / fps;
  const sceneSeconds = (index: number) => (plan.sceneFrames[index] ?? 0) / fps;
  const source = (slide: Slide) => photoSource(assetSet, slide);
  const picture = surface ?? PhotoSurface;

  const children: ReactNode[] = [];
  list.forEach((slide, index) => {
    const next = list[index + 1];
    children.push(
      <TransitionScene key={`scene-${slide.id}`} duration={at(plan.sceneFrames[index] ?? 0)}>
        <SlideFrame
          slide={slide}
          source={source(slide)}
          index={index}
          total={list.length}
          surface={picture}
        />
      </TransitionScene>,
    );
    if (next === undefined) return;
    children.push(
      <Transition key={`fade-${slide.id}`} duration={at(plan.crossfadeFrames)}>
        <CrossFade
          outgoing={{ slide, source: source(slide), index, seconds: sceneSeconds(index) }}
          incoming={{
            slide: next,
            source: source(next),
            index: index + 1,
            seconds: sceneSeconds(index + 1),
          }}
          total={list.length}
          crossfadeSeconds={crossfadeSeconds}
          surface={picture}
        />
      </Transition>,
    );
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: INK,
        color: CHALK,
        fontFamily: FONT_STACK,
      }}
    >
      <TransitionSeries>{children}</TransitionSeries>
    </div>
  );
};

/** The `-ci` Composition's scene: the first three slides through the same tree. */
export const SlideshowCiScene = () => <SlideshowScene assetSet="placeholder" slides={ciSlides} />;
