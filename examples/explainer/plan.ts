import { type Character } from './look.ts';
// The storyboard: the script's data turned into whole frames, once, for all three layers.
//
// `script.schema.ts` owns the timing arithmetic in seconds; this file is the only place that
// converts to the Composition's frame grid, so the slide layer, the subtitle layer and the sprite
// layer cannot disagree: each takes the same `Storyboard`. Every frame count is an integer because
// every line's seconds are.
import {
  lineStartTimes,
  slidePlan,
  totalSeconds as totalSecondsOf,
  type Expression,
  type ScriptLine,
  type SlideCue,
} from './script.schema.ts';
import { script } from './script.ts';

/** One spoken line, placed on the frame grid. */
export type PlannedLine = {
  readonly id: string;
  readonly speaker: Character;
  readonly text: string;
  readonly expression: Expression;
  readonly startFrame: number;
  readonly frames: number;
};

/** One slide cue, and the span a `TransitionScene` declares for it. */
export type PlannedSlide = {
  readonly index: number;
  readonly cue: SlideCue;
  /** The frame its `TransitionScene` starts on: its first line's frame. */
  readonly startFrame: number;
  /** The `TransitionScene`'s duration: the dialogue plus the outgoing overlap (plus the tail, last). */
  readonly frames: number;
  /** The frames its content is drawn on: the dialogue, plus the held tail on the last slide. */
  readonly contentFrames: number;
};

export type Storyboard = {
  readonly fps: number;
  /** 0.4 s of crossfade between two slides, on the frame grid. */
  readonly overlapFrames: number;
  readonly durationInFrames: number;
  readonly slides: readonly PlannedSlide[];
  readonly lines: readonly PlannedLine[];
};

/** Exactly `frames` per `seconds`: both numbers come from the script, so nothing ever rounds. */
const toFrames = (seconds: number, fps: number): number => Math.round(seconds * fps);

const placeLines = (lines: readonly ScriptLine[], fps: number): readonly PlannedLine[] => {
  const starts = lineStartTimes(lines);
  return lines.map((line, index) => ({
    id: line.id,
    speaker: line.speaker,
    text: line.text,
    expression: line.expression,
    startFrame: toFrames(starts[index] ?? 0, fps),
    frames: toFrames(line.seconds, fps),
  }));
};

/**
 * The full video's storyboard: the script's own line seconds and slide spans, converted once. The
 * last `TransitionScene` declares the disclaimer's held 3-second tail as well, so the series ends
 * exactly at `totalSeconds` rather than 3 seconds short of the Composition.
 */
export const explainerStoryboard = (fps: number): Storyboard => {
  const spans = slidePlan(script.lines);
  const overlapFrames = toFrames(0.4, fps);
  const slides = spans.map((span, index) => {
    const last = index === spans.length - 1;
    return {
      index,
      cue: span.cue,
      startFrame: toFrames(span.startSeconds, fps),
      frames: toFrames(last ? span.onScreenSeconds : span.sceneSeconds, fps),
      contentFrames: toFrames(span.onScreenSeconds, fps),
    };
  });
  return {
    fps,
    overlapFrames,
    durationInFrames: toFrames(totalSecondsOf(script.lines), fps),
    slides,
    lines: placeLines(script.lines, fps),
  };
};

/** One slide of a short storyboard: a cue, its span, and the script lines that sit under it. */
export type ShortSlideSpec = {
  readonly cue: SlideCue;
  readonly frames: number;
  readonly lines: readonly { readonly id: string; readonly frames: number }[];
};

/**
 * A short storyboard: the `-ci` Composition's and the probe's. It reuses real script lines (so the
 * text, the speaker, the expression and the slide wording are the video's own) retimed onto a short
 * clip, and lays them out with the same overlap rule the full video uses. Slide `i` starts where its
 * predecessor's outgoing overlap ends, and a line starts where the previous one in its slide did.
 */
export const shortStoryboard = (
  fps: number,
  spec: readonly ShortSlideSpec[],
  overlapFrames: number,
): Storyboard => {
  const byId = new Map(script.lines.map((line) => [line.id, line]));
  const slides: PlannedSlide[] = [];
  const lines: PlannedLine[] = [];
  let slideStart = 0;
  let durationInFrames = 0;
  spec.forEach((item, index) => {
    slides.push({
      index,
      cue: item.cue,
      startFrame: slideStart,
      frames: item.frames,
      contentFrames: item.frames,
    });
    let at = slideStart;
    for (const placed of item.lines) {
      const source = byId.get(placed.id);
      if (source === undefined) throw new Error(`explainer: unknown line ${placed.id}`);
      lines.push({
        id: source.id,
        speaker: source.speaker,
        text: source.text,
        expression: source.expression,
        startFrame: at,
        frames: placed.frames,
      });
      at += placed.frames;
    }
    durationInFrames = slideStart + item.frames;
    slideStart += item.frames - overlapFrames;
  });
  return { fps, overlapFrames, durationInFrames, slides, lines };
};

/**
 * `explainer-ci`: 60 frames at 30 fps. One dialogue line on the `まとめ` bullets slide, a 0.4 s
 * crossfade, and the disclaimer slide with its tail — the three layers, a `Transition` overlap, two
 * placeholder images and Japanese text through the committed face, in two seconds.
 */
export const ciStoryboard = (): Storyboard => {
  const fps = 30;
  const overlap = 12;
  return shortStoryboard(
    fps,
    [
      {
        cue: script.lines.find((line) => line.id === 'summary-2')?.slide ?? {
          kind: 'title',
          text: script.title,
        },
        frames: 36,
        lines: [{ id: 'summary-2', frames: 24 }],
      },
      {
        cue: { kind: 'disclaimer', text: script.disclaimer },
        frames: 36,
        lines: [{ id: 'disclaimer-1', frames: 36 }],
      },
    ],
    overlap,
  );
};

/** `explainer-probe`: the same shape at 480x270 for 30 frames, with flat surfaces instead of media. */
export const probeStoryboard = (): Storyboard => {
  const fps = 30;
  const overlap = 12;
  return shortStoryboard(
    fps,
    [
      {
        cue: script.lines.find((line) => line.id === 'summary-2')?.slide ?? {
          kind: 'title',
          text: script.title,
        },
        frames: 21,
        lines: [{ id: 'summary-2', frames: 15 }],
      },
      {
        cue: { kind: 'disclaimer', text: script.disclaimer },
        frames: 21,
        lines: [{ id: 'disclaimer-1', frames: 15 }],
      },
    ],
    overlap,
  );
};
