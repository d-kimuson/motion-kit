// The storyboard: the script's data turned into whole frames, once, for all three layers.
//
// `script.schema.ts` owns the timing arithmetic in seconds; this file is the only place that
// converts to the Composition's frame grid, so the slide layer, the subtitle layer and the speaker
// layer cannot disagree: each takes the same `Storyboard`. Every frame count is an integer because
// every line's seconds are.
import { type Character } from './look.ts';
import {
  codePointLength,
  lineStartTimes,
  slidePlan,
  splitSentences,
  totalSeconds as totalSecondsOf,
  type Expression,
  type ScriptLine,
  type SlideCue,
} from './script.schema.ts';
import { script } from './script.ts';

/**
 * One sentence of a line, on the frame grid: the subtitle shows one sentence at a time, and a scene
 * times its beats to the words a sentence says (`phraseTime`). A line's frames are shared between
 * its sentences in proportion to their code points, the same five-per-second rule the line's own
 * seconds come from, and `fetch-assets.ts` fits each sentence's voice to exactly this slot.
 */
export type PlannedSentence = {
  readonly lineId: string;
  readonly speaker: Character;
  readonly text: string;
  /** The line's emphasis words that occur in this sentence. */
  readonly emphasis: readonly string[];
  readonly startFrame: number;
  readonly frames: number;
};

/** One spoken line, placed on the frame grid. */
export type PlannedLine = {
  readonly id: string;
  readonly speaker: Character;
  readonly text: string;
  readonly expression: Expression;
  readonly startFrame: number;
  readonly frames: number;
  readonly sentences: readonly PlannedSentence[];
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
  /** The sentences spoken over it, in order, on the absolute frame grid. */
  readonly sentences: readonly PlannedSentence[];
};

export type Storyboard = {
  readonly fps: number;
  /** 0.4 s of crossfade between two slides, on the frame grid. */
  readonly overlapFrames: number;
  readonly durationInFrames: number;
  readonly slides: readonly PlannedSlide[];
  readonly lines: readonly PlannedLine[];
};

/**
 * Exactly `frames` per `seconds`. The script's seconds sit on whole frames at the rates the example
 * plans at, so the round only removes floating-point noise; a time between two frames is a script
 * error, and it throws rather than move a boundary.
 */
const toFrames = (seconds: number, fps: number): number => {
  const frames = Math.round(seconds * fps);
  if (Math.abs(frames - seconds * fps) > 1e-6)
    throw new Error(`${String(seconds)} s is not a whole frame at ${String(fps)} fps`);
  return frames;
};

/**
 * Where the outgoing slide's own clock stands when the crossfade hands it to the overlay: the frames
 * its own scene drew (`contentFrames`), plus the overlap already elapsed. At the overlap's first frame
 * this is one frame past the last frame that scene drew, so the slide keeps animating instead of
 * jumping at either edge of the crossfade.
 */
export const crossFadeTime = (slide: PlannedSlide, fps: number, elapsedSeconds: number): number =>
  slide.contentFrames / fps + elapsedSeconds;

/**
 * A line's sentences on its own frames: boundary `k` sits at the share of the line's code points
 * spoken before sentence `k`, rounded once, so the slots tile the line exactly with no gap.
 */
export const placeSentences = (
  line: Pick<ScriptLine, 'id' | 'speaker' | 'text' | 'emphasis'>,
  startFrame: number,
  frames: number,
): readonly PlannedSentence[] => {
  const sentences = splitSentences(line.text);
  const total = sentences.reduce((sum, text) => sum + codePointLength(text), 0);
  let spoken = 0;
  return sentences.map((text) => {
    const from = Math.round((frames * spoken) / total);
    spoken += codePointLength(text);
    const to = Math.round((frames * spoken) / total);
    return {
      lineId: line.id,
      speaker: line.speaker,
      text,
      emphasis: line.emphasis.filter((word) => text.includes(word)),
      startFrame: startFrame + from,
      frames: to - from,
    };
  });
};

const planLine = (line: ScriptLine, startFrame: number, frames: number): PlannedLine => ({
  id: line.id,
  speaker: line.speaker,
  text: line.text,
  expression: line.expression,
  startFrame,
  frames,
  sentences: placeSentences(line, startFrame, frames),
});

const placeLines = (lines: readonly ScriptLine[], fps: number): readonly PlannedLine[] => {
  const starts = lineStartTimes(lines);
  return lines.map((line, index) =>
    planLine(line, toFrames(starts[index] ?? 0, fps), toFrames(line.seconds, fps)),
  );
};

/** The sentences a slide shows: those of the lines that start inside its span, in order. */
const sentencesIn = (
  lines: readonly PlannedLine[],
  startFrame: number,
  endFrame: number,
): readonly PlannedSentence[] =>
  lines
    .filter((line) => line.startFrame >= startFrame && line.startFrame < endFrame)
    .flatMap((line) => line.sentences);

/**
 * When a slide's narration reaches `phrase`, in seconds since the slide's own zero: the start of the
 * sentence that holds it, plus the phrase's share of that sentence's slot. A scene keys a beat to
 * the word that names it ("225社", "コストが低いほう") rather than to a hand-written second, so an
 * edit to the narration moves the picture with it.
 *
 * `undefined` when the slide does not say it: a short storyboard narrates only part of a slide, and
 * the scene treats an unsaid phrase as already said (`scenes/kit.tsx`). On the full storyboard every
 * phrase a scene asks for must resolve, which `scenes/scenes.test.ts` checks.
 */
export const phraseTime = (
  slide: PlannedSlide,
  phrase: string,
  fps: number,
): number | undefined => {
  for (const sentence of slide.sentences) {
    const at = sentence.text.indexOf(phrase);
    if (at < 0) continue;
    const before = codePointLength(sentence.text.slice(0, at));
    const share = before / codePointLength(sentence.text);
    return (sentence.startFrame - slide.startFrame + share * sentence.frames) / fps;
  }
  return undefined;
};

/**
 * The full video's storyboard: the script's own line seconds and slide spans, converted once. The
 * last `TransitionScene` declares the disclaimer's held 3-second tail as well, so the series ends
 * exactly at `totalSeconds` rather than 3 seconds short of the Composition.
 */
export const explainerStoryboard = (fps: number): Storyboard => {
  const spans = slidePlan(script.lines);
  const overlapFrames = toFrames(0.4, fps);
  const lines = placeLines(script.lines, fps);
  const slides = spans.map((span, index) => {
    const last = index === spans.length - 1;
    const startFrame = toFrames(span.startSeconds, fps);
    const contentFrames = toFrames(span.onScreenSeconds, fps);
    return {
      index,
      cue: span.cue,
      startFrame,
      frames: toFrames(last ? span.onScreenSeconds : span.sceneSeconds, fps),
      contentFrames,
      sentences: sentencesIn(lines, startFrame, startFrame + contentFrames),
    };
  });
  return {
    fps,
    overlapFrames,
    durationInFrames: toFrames(totalSecondsOf(script.lines), fps),
    slides,
    lines,
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
    // The scene declares its dialogue plus its outgoing overlap, and `contentFrames` is where that
    // dialogue stops — the same rule the full storyboard follows, so a short storyboard crossfades
    // without a jump: the overlay hands the outgoing slide `contentFrames + elapsed`, one frame past
    // the last frame its own scene drew. Only the last slide draws through its whole span (the tail).
    const last = index === spec.length - 1;
    const placedLines: PlannedLine[] = [];
    let at = slideStart;
    for (const placed of item.lines) {
      const source = byId.get(placed.id);
      if (source === undefined) throw new Error(`explainer: unknown line ${placed.id}`);
      placedLines.push(planLine(source, at, placed.frames));
      at += placed.frames;
    }
    lines.push(...placedLines);
    slides.push({
      index,
      cue: item.cue,
      startFrame: slideStart,
      frames: item.frames,
      contentFrames: last ? item.frames : item.frames - overlapFrames,
      sentences: placedLines.flatMap((line) => line.sentences),
    });
    durationInFrames = slideStart + item.frames;
    slideStart += item.frames - overlapFrames;
  });
  return { fps, overlapFrames, durationInFrames, slides, lines };
};

/** The cue a script line carries, for a short storyboard that reuses it. */
const cueOf = (id: string): SlideCue => {
  const line = script.lines.find((item) => item.id === id);
  if (line === undefined) throw new Error(`explainer: unknown line ${id}`);
  return line.slide;
};

/**
 * `explainer-ci`: 60 frames at 30 fps. One dialogue line on the `まとめ` checklist slide, a 0.4 s
 * crossfade, and the disclaimer slide with its tail — the three layers, a `Transition` overlap, two
 * placeholder characters and Japanese text through the committed face, in two seconds.
 */
export const ciStoryboard = (): Storyboard => {
  const fps = 30;
  const overlap = 12;
  return shortStoryboard(
    fps,
    [
      {
        cue: cueOf('summary-2'),
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
        cue: cueOf('summary-2'),
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

/**
 * What is on at `frame`: the line being spoken, the sentence of it the subtitle shows, and the slide
 * the top bar names. The latest one to have started wins, so where a short storyboard overlaps two
 * lines the newer speaker has the floor. Pure lookups, so the layers that read them stay functions of
 * the frame and the tests can walk a whole storyboard without rendering it.
 */
const latestAt = <T extends { readonly startFrame: number; readonly frames: number }>(
  items: readonly T[],
  frame: number,
): T | undefined =>
  items.findLast((item) => item.startFrame <= frame && frame < item.startFrame + item.frames);

export const lineAt = (storyboard: Storyboard, frame: number): PlannedLine | undefined =>
  latestAt(storyboard.lines, frame);

export const sentenceAt = (storyboard: Storyboard, frame: number): PlannedSentence | undefined =>
  latestAt(
    storyboard.lines.flatMap((line) => line.sentences),
    frame,
  );

export const slideAt = (storyboard: Storyboard, frame: number): PlannedSlide | undefined =>
  latestAt(storyboard.slides, frame);
