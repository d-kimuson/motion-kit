// The slide layer: one `TransitionSeries` over the script's slides, 0.4 s between adjacent ones.
//
// Scene `i` declares "its lines plus its outgoing overlap", and the next scene starts where that
// overlap begins, so slide `i` starts exactly at its first line and the handoff runs over the first
// 0.4 s of the *incoming* slide's first line. The series therefore lasts exactly the dialogue total
// (plus the disclaimer's held tail), which is the Composition's own length.
//
// A scene yields the frames of its own entrance and exit overlaps to the section's `Transition`
// overlay: if it kept drawing through them, the outgoing and incoming slides would paint on top of
// each other at full opacity. The overlay draws both, so exactly one of the three renders a slide at
// any frame. Every scene draws inside the `STAGE` box; the panel under it is the background layer's.
import {
  Transition,
  TransitionScene,
  TransitionSeries,
  useFrame,
  useTime,
  useTransitionProgress,
} from '@kimuson/motion-kit';
import { type CSSProperties, type ReactNode } from 'react';

import { STAGE, easeInCubic, easeOutCubic, framesToTime } from '../look.ts';
import { crossFadeTime, type Storyboard } from '../plan.ts';
import { SceneFor } from '../scenes/Scene.tsx';
import { FlatSlide } from './FlatSlide.tsx';
import { useFlat } from './shared.ts';

type BoardIndex = { readonly storyboard: Storyboard; readonly index: number };

/** The stage box a scene draws in, clipped so an arrival's overshoot never leaves the panel. */
const Stage = ({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) => (
  <div
    style={{
      position: 'absolute',
      left: STAGE.left,
      top: STAGE.top,
      width: STAGE.width,
      height: STAGE.height,
      overflow: 'hidden',
      borderRadius: 28,
      ...style,
    }}
  >
    {children}
  </div>
);

/** A slide inside its own scene: the enclosing `Sequence` is already the slide's own zero. */
const SlideScene = ({ storyboard, index }: BoardIndex) => {
  const frame = useFrame();
  const time = useTime();
  const flat = useFlat();
  const slide = storyboard.slides[index];
  if (slide === undefined) return null;
  const localFrame = frame - slide.startFrame;
  const enters = index === 0 ? 0 : storyboard.overlapFrames;
  const exits = index === storyboard.slides.length - 1 ? 0 : storyboard.overlapFrames;
  const visible = localFrame >= enters && (exits === 0 || localFrame < slide.frames - exits);
  if (!visible) return null;
  if (flat) return <FlatSlide slide={slide} />;
  return (
    <Stage>
      <SceneFor slide={slide} time={time} fps={storyboard.fps} />
    </Stage>
  );
};

/**
 * The one shared handoff: the outgoing scene lifts away and fades on a decelerating curve while the
 * incoming one rises into place on an accelerating one, both read from `useTransitionProgress()`.
 * Outgoing `1 - p³` and incoming `p³` sum to at most 1 in every frame, so the handoff never shows two
 * scenes at full opacity.
 *
 * The outgoing scene keeps animating: inside the overlay its own scene would be at `contentFrames`
 * plus the elapsed overlap, so it is handed exactly that time (`crossFadeTime`) and its entrance does
 * not replay. `contentFrames` is where the outgoing scene stopped drawing, in both storyboards.
 *
 * Under `flat` the handoff is a discrete switch instead: the overlay draws the incoming slide alone,
 * fully opaque, from the overlap's first frame. A probe may not blend two layers at fractional
 * alpha — that is paint state, and paint state is what a traversal mode changes — so the switch
 * happens on a frame boundary and every frame is still the same bytes whatever order it is drawn in.
 */
const SlideHandoff = ({ storyboard, index }: BoardIndex) => {
  const progress = useTransitionProgress();
  const elapsed = useTime();
  const flat = useFlat();
  const outgoing = storyboard.slides[index];
  const incoming = storyboard.slides[index + 1];
  if (outgoing === undefined || incoming === undefined) return null;
  if (flat) return <FlatSlide slide={incoming} />;
  const out = easeOutCubic(progress);
  const into = easeInCubic(progress);
  return (
    <>
      <Stage
        style={{
          opacity: 1 - out,
          transform: `translateY(${String(-28 * out)}px) scale(${String(1 - 0.03 * out)})`,
        }}
      >
        <SceneFor
          slide={outgoing}
          time={crossFadeTime(outgoing, storyboard.fps, elapsed)}
          fps={storyboard.fps}
        />
      </Stage>
      <Stage style={{ opacity: into, transform: `translateY(${String(36 * (1 - into))}px)` }}>
        <SceneFor slide={incoming} time={elapsed} fps={storyboard.fps} />
      </Stage>
    </>
  );
};

export const SlideSeries = ({ storyboard }: { readonly storyboard: Storyboard }) => {
  const children: ReactNode[] = [];
  storyboard.slides.forEach((slide, index) => {
    children.push(
      <TransitionScene
        key={`slide-${String(slide.index)}`}
        duration={framesToTime(slide.frames, storyboard.fps)}
      >
        <SlideScene storyboard={storyboard} index={index} />
      </TransitionScene>,
    );
    if (index < storyboard.slides.length - 1)
      children.push(
        <Transition
          key={`handoff-${String(slide.index)}`}
          duration={framesToTime(storyboard.overlapFrames, storyboard.fps)}
        >
          <SlideHandoff storyboard={storyboard} index={index} />
        </Transition>,
      );
  });
  return <TransitionSeries>{children}</TransitionSeries>;
};
