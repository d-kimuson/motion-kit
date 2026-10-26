import {
  Transition,
  TransitionScene,
  TransitionSeries,
  useFrame,
  useSequence,
  useTimeline,
  useTransitionProgress,
} from '@kimuson/motion-kit';
import { type ReactNode, useMemo } from 'react';

import {
  clamp01,
  easeInCubic,
  easeOutCubic,
  springChain,
  springStep,
  type SpringTarget,
} from './motion.ts';

// The teaser's whole look: one dark ground, one accent, one type face. Phase 2 replaces every value
// here with a /theme token; the tree below does not change.
const INK = '#07080c';
const CHALK = '#f5f2ec';
const ACCENT = '#ff5a3c';
const FONT_STACK =
  "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";
const MONO_STACK = "'SF Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace";

/** 35 ms of stagger between letters: the acceptance look asks for 30–50 ms. */
const STAGGER_SECONDS = 0.035;
/** The stagger of small elements behind the type: 8–20, per the design doc. */
const BAR_COUNT = 16;

/**
 * Word scenes and their crossfades, in whole frames, derived from the Composition's own duration so
 * that the full teaser, its `-ci` twin and its probe render the same tree at three different sizes.
 * Scene `i` occupies `sceneFrames[i]` frames and the next scene starts `overlapFrames` earlier, so
 * the series lasts exactly `totalFrames`.
 */
export type WordPlan = {
  readonly overlapFrames: number;
  readonly sceneFrames: readonly number[];
  readonly startFrames: readonly number[];
};

export const planWords = (totalFrames: number, wordCount: number): WordPlan => {
  const count = Math.max(1, wordCount);
  // A crossfade is a fifth of a scene on average, capped so a short Composition still shows a word.
  const overlapFrames = Math.max(2, Math.min(12, Math.round(totalFrames / (count * 5))));
  const evenFrames = Math.ceil((totalFrames + (count - 1) * overlapFrames) / count);
  const sceneFrames = Array.from({ length: count }, (_, index) =>
    index === count - 1
      ? totalFrames + (count - 1) * overlapFrames - (count - 1) * evenFrames
      : evenFrames,
  );
  const startFrames: number[] = [];
  let start = 0;
  for (const [index, frames] of sceneFrames.entries()) {
    startFrames.push(start);
    start += index === count - 1 ? frames : frames - overlapFrames;
  }
  return { overlapFrames, sceneFrames, startFrames };
};

// The backdrop's targets are fixed tables, not a generator, so every frame is a pure function of
// time and nothing is shared between renders.
const BAR_HEIGHTS = [0.9, 0.34, 1, 0.5, 0.76, 0.22, 0.95, 0.6, 0.42, 1, 0.54, 0.86] as const;
const GLOW_X = [0.7, -0.55, 0.35, -0.85, 0.15, 0.6, -0.3] as const;
const GLOW_Y = [-0.4, 0.5, -0.15, 0.35, -0.6, 0.2, 0.45] as const;

const barTargets = (index: number): readonly SpringTarget[] =>
  Array.from({ length: 10 }, (_, step) => ({
    at: 0.12 + step * 1.15 + index * STAGGER_SECONDS,
    to: BAR_HEIGHTS[(step + index) % BAR_HEIGHTS.length] ?? 0.5,
  }));

const glowTargets = (table: readonly number[]): readonly SpringTarget[] =>
  Array.from({ length: 12 }, (_, step) => ({
    at: step * 1.45,
    to: table[step % table.length] ?? 0,
  }));

type BackdropProps = { readonly wordStartsSeconds: readonly number[] };

/** Everything that keeps moving for the whole clip: the glow, sixteen staggered bars, three
 * hairlines, the word counter and the progress rule. Composition-scoped time, so it is identical
 * inside a `Transition` overlay and behind the scenes. */
const Backdrop = ({ wordStartsSeconds }: BackdropProps) => {
  const timeline = useTimeline();
  const { time, width, height } = timeline;
  const glowX = springChain(time, glowTargets(GLOW_X), 0.8, 3.2);
  const glowY = springChain(time, glowTargets(GLOW_Y), 0.8, 3.2);
  const glowSize = Math.max(width, height) * 0.95;
  const barWidth = Math.max(2, Math.round(width * 0.0016));
  const activeIndex = wordStartsSeconds.reduce(
    (active, start, index) => (time >= start ? index : active),
    0,
  );
  const counter = `${String(activeIndex + 1).padStart(2, '0')} / ${String(wordStartsSeconds.length).padStart(2, '0')}`;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: glowSize,
          height: glowSize,
          left: width * 0.5 - glowSize / 2 + glowX * width * 0.24,
          top: height * 0.44 - glowSize / 2 + glowY * height * 0.24,
          background: `radial-gradient(circle, ${ACCENT}2b 0%, ${ACCENT}0d 30%, transparent 58%)`,
        }}
      />
      {[0.24, 0.5, 0.76].map((ratio, index) => (
        <div
          key={`hairline-${String(index)}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: height * ratio,
            height: 1,
            background: CHALK,
            opacity: 0.05,
            transform: `translateX(${springChain(time, glowTargets(GLOW_X), 0.9, 2.2) * width * 0.02}px)`,
          }}
        />
      ))}
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        const value = clamp01(
          springChain(time - index * STAGGER_SECONDS, barTargets(index), 0.7, 9),
        );
        return (
          <div
            key={`bar-${String(index)}`}
            style={{
              position: 'absolute',
              left: ((index + 0.5) / BAR_COUNT) * width - barWidth / 2,
              bottom: height * 0.1,
              width: barWidth,
              height: height * 0.02 + height * 0.16 * value,
              background: ACCENT,
              opacity: 0.2 + 0.7 * value,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          right: width * 0.045,
          top: height * 0.05,
          fontFamily: MONO_STACK,
          fontSize: Math.round(height * 0.022),
          letterSpacing: '0.3em',
          color: CHALK,
          opacity: 0.4,
        }}
      >
        {counter}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: Math.max(2, Math.round(height * 0.004)),
          width: width * timeline.progress,
          background: ACCENT,
          opacity: 0.8,
        }}
      />
    </div>
  );
};

type WordStageProps = {
  readonly text: string;
  /** Seconds since this word's own zero, or null for the word at rest. */
  readonly time: number | null;
  /** How long the letters' entry takes; a shorter scene gets a shorter spring. */
  readonly enterSeconds: number;
  /** Extra offset as a fraction of the frame height, for a crossfade's slide. */
  readonly lift?: number;
};

/** The type: one letter per span, each on its own spring, plus the accent rule that follows them.
 * Presentational — a caller decides what time to show it at, so the same component serves its own
 * scene and the crossfade overlay and the two agree pixel for pixel.
 *
 * Two details are load-bearing for the determinism gate. The vertical entry is a spring on the whole
 * block, and each letter only scales and fades: a `translateY` on an individual text span is what
 * made this example fail `reverse` and `random` — Chromium re-rasterises a transformed glyph run
 * differently between paints, so the same frame produced three different PNGs. */
const WordStage = ({ text, time, enterSeconds, lift = 0 }: WordStageProps) => {
  const { width, height } = useTimeline();
  const fontSize = Math.round(height * 0.155);
  const omega = 7 / Math.max(0.08, enterSeconds);
  // The teaser's words are ASCII, so one character is one letter.
  const letters = Array.from(text);
  const group = time === null ? 1 : springStep(time, 0.72, omega);
  const rule = time === null ? 1 : springStep(time - 0.1, 0.72, omega);
  const ruleOpacity = time === null ? 1 : clamp01((time - 0.1) * 8);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: Math.round(height * 0.04),
        transform: `translateY(${((1 - group) * 0.08 + lift) * height}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: CHALK,
        }}
      >
        {letters.map((letter, index) => {
          const local = time === null ? 1 : time - index * STAGGER_SECONDS;
          const spring = time === null ? 1 : springStep(local, 0.72, omega);
          const opacity = time === null ? 1 : clamp01((local + 0.05) * 14);
          return (
            <span
              key={`${letter}-${String(index)}`}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                opacity,
                transform: `scale(${0.78 + 0.22 * spring})`,
              }}
            >
              {letter}
            </span>
          );
        })}
      </div>
      <div
        style={{
          width: Math.round(width * 0.17),
          height: Math.max(2, Math.round(height * 0.006)),
          background: ACCENT,
          opacity: ruleOpacity,
          transform: `scaleX(${Math.max(0, rule)})`,
        }}
      />
    </div>
  );
};

type WordSceneProps = {
  readonly text: string;
  readonly firstFrame: number;
  readonly sceneFrames: number;
  readonly enterFrames: number;
  readonly exitFrames: number;
  readonly enterSeconds: number;
};

/** One word between its crossfades. The word itself is drawn by the `Transition` overlay during an
 * overlap, so the scene yields those frames: that is what keeps the two words from ever painting on
 * top of each other at full opacity. */
const WordScene = ({
  text,
  firstFrame,
  sceneFrames,
  enterFrames,
  exitFrames,
  enterSeconds,
}: WordSceneProps) => {
  const frame = useFrame();
  const { time } = useSequence();
  const visible =
    frame >= firstFrame + enterFrames && frame < firstFrame + sceneFrames - exitFrames;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {visible ? <WordStage text={text} time={time} enterSeconds={enterSeconds} /> : null}
    </div>
  );
};

type CrossFadeProps = {
  readonly outgoing: string;
  readonly incoming: string;
  readonly incomingEnterSeconds: number;
};

/** The one shared crossfade: the incoming word leaves on its easing curve while the outgoing word
 * fades and lifts on `useTransitionProgress()`. Its children mount only during the overlap. The
 * offset rides on each `WordStage`, never on the full-frame layer that holds it: a transform on the
 * layer changed how Chromium rasterised the whole frame between paints, and the determinism gate
 * caught it. */
const CrossFade = ({ outgoing, incoming, incomingEnterSeconds }: CrossFadeProps) => {
  const progress = useTransitionProgress();
  const { time } = useSequence();
  const out = easeInCubic(progress);
  const lift = easeOutCubic(progress);
  const into = easeOutCubic(progress);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1 - out,
        }}
      >
        <WordStage
          text={outgoing}
          time={null}
          enterSeconds={incomingEnterSeconds}
          lift={-0.28 * lift}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: into,
        }}
      >
        <WordStage
          text={incoming}
          time={time}
          enterSeconds={incomingEnterSeconds}
          lift={0.24 * (1 - into)}
        />
      </div>
    </div>
  );
};

type TeaserSceneProps = { readonly words: readonly string[] };

/** The teaser. Its `-ci` twin and its probe render this same component with a shorter word list and
 * a shorter duration, never a simplified copy. */
export const TeaserScene = ({ words }: TeaserSceneProps) => {
  const timeline = useTimeline();
  const { frameRate, durationInFrames } = timeline;
  const fps = Number(frameRate.numerator) / Number(frameRate.denominator);
  const plan = useMemo(
    () => planWords(durationInFrames, words.length),
    [durationInFrames, words.length],
  );
  const at = (frames: number) => ({
    numerator: frames * Number(frameRate.denominator),
    denominator: Number(frameRate.numerator),
  });
  const enterSeconds = plan.sceneFrames.map((frames) => Math.min(0.34, (frames / fps) * 0.45));
  const wordStartsSeconds = plan.startFrames.map((frame) => frame / fps);

  const children: ReactNode[] = [];
  words.forEach((word, index) => {
    const next = words[index + 1];
    const sceneFrames = plan.sceneFrames[index] ?? 0;
    children.push(
      <TransitionScene key={`scene-${String(index)}`} duration={at(sceneFrames)}>
        <WordScene
          text={word}
          firstFrame={plan.startFrames[index] ?? 0}
          sceneFrames={sceneFrames}
          enterFrames={index === 0 ? 0 : plan.overlapFrames}
          exitFrames={next === undefined ? 0 : plan.overlapFrames}
          enterSeconds={enterSeconds[index] ?? 0.3}
        />
      </TransitionScene>,
    );
    if (next !== undefined)
      children.push(
        <Transition key={`fade-${String(index)}`} duration={at(plan.overlapFrames)}>
          <CrossFade
            outgoing={word}
            incoming={next}
            incomingEnterSeconds={enterSeconds[index + 1] ?? 0.3}
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
      <Backdrop wordStartsSeconds={wordStartsSeconds} />
      <TransitionSeries>{children}</TransitionSeries>
    </div>
  );
};
