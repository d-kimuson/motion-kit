// The slide layer: one `TransitionSeries` over the script's slides, 0.4 s between adjacent ones.
//
// Scene `i` declares "its lines plus its outgoing overlap", and the next scene starts where that
// overlap begins, so slide `i` starts exactly at its first line and the crossfade runs over the first
// 0.4 s of the *incoming* slide's first line. The series therefore lasts exactly the dialogue total
// (plus the disclaimer's held tail), which is the Composition's own length.
//
// A scene yields the frames of its own entrance and exit overlaps to the section's `Transition`
// overlay: if it kept drawing through them, the outgoing and incoming slides would paint on top of
// each other at full opacity. The overlay draws both, so exactly one of the three renders a slide at
// any frame.
import {
  Transition,
  TransitionScene,
  TransitionSeries,
  useFrame,
  useTime,
  useTransitionProgress,
} from '@kimuson/motion-kit';
import { type ReactNode } from 'react';

import { easeInCubic, easeOutCubic, framesToTime } from '../look.ts';
import { crossFadeTime, type Storyboard } from '../plan.ts';
import { FlatSlide } from './FlatSlide.tsx';
import { useFlat } from './shared.ts';
import { Slide } from './Slide.tsx';

type BoardIndex = { readonly storyboard: Storyboard; readonly index: number };

/** A slide inside its own scene: the enclosing `Sequence` is already the slide's own zero. */
const SlideScene = ({ storyboard, index }: BoardIndex) => {
  const frame = useFrame();
  const flat = useFlat();
  const slide = storyboard.slides[index];
  if (slide === undefined) return null;
  const localFrame = frame - slide.startFrame;
  const enters = index === 0 ? 0 : storyboard.overlapFrames;
  const exits = index === storyboard.slides.length - 1 ? 0 : storyboard.overlapFrames;
  const visible = localFrame >= enters && (exits === 0 || localFrame < slide.frames - exits);
  if (!visible) return null;
  return flat ? <FlatSlide slide={slide} /> : <Slide slide={slide} />;
};

/**
 * The one shared crossfade: the outgoing slide leaves on a decelerating curve while the incoming one
 * arrives on an accelerating one, both read from `useTransitionProgress()`. Outgoing `1 - p³` and
 * incoming `p³` sum to at most 1 in every frame, so the handoff dims the deck but can never show two
 * slides at full opacity — the acceptance look's requirement.
 *
 * The outgoing slide keeps animating: inside the overlay its own scene would be at `contentFrames`
 * plus the elapsed overlap, so it is handed exactly that time (`crossFadeTime`) and its entrance does
 * not replay. `contentFrames` is where the outgoing scene stopped drawing, in both storyboards.
 *
 * Under `flat` the handoff is a discrete switch instead: the overlay draws the incoming slide alone,
 * fully opaque, from the overlap's first frame. A probe may not blend two layers at fractional
 * alpha — that is paint state, and paint state is what a traversal mode changes — so the switch
 * happens on a frame boundary and every frame is still the same bytes whatever order it is drawn in.
 */
const SlideCrossFade = ({ storyboard, index }: BoardIndex) => {
  const progress = useTransitionProgress();
  const elapsed = useTime();
  const flat = useFlat();
  const outgoing = storyboard.slides[index];
  const incoming = storyboard.slides[index + 1];
  if (outgoing === undefined || incoming === undefined) return null;
  if (flat) return <FlatSlide slide={incoming} />;
  const outgoingTime = crossFadeTime(outgoing, storyboard.fps, elapsed);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - easeOutCubic(progress) }}>
        <Slide slide={outgoing} time={outgoingTime} />
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: easeInCubic(progress) }}>
        <Slide slide={incoming} />
      </div>
    </div>
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
          key={`crossfade-${String(slide.index)}`}
          duration={framesToTime(storyboard.overlapFrames, storyboard.fps)}
        >
          <SlideCrossFade storyboard={storyboard} index={index} />
        </Transition>,
      );
  });
  return <TransitionSeries>{children}</TransitionSeries>;
};
