// The shape of the `explainer` script, and the timing arithmetic the example derives from it.
//
// The format is fixed by docs/design-doc/20261025-reference-examples.md ("explainer"): every line
// carries its own duration, `seconds = ceil(codePoints(text) / 5)`, and the video's length is the sum
// of those durations plus a 3-second tail for the disclaimer. Nothing here renders: the file is data
// contract plus pure functions, so `script.ts`, the entry and the test cannot disagree about seconds.
// The only import is Zod, because this is the part of the example that validates, not the part that
// draws.
import { z } from 'zod';

/** Five Japanese characters per second, counted over the raw text including punctuation. */
export const codePointsPerSecond = 5;

/** The crossfade between two adjacent slides: 0.4 s, i.e. 12 frames at 30 fps. */
export const slideOverlapSeconds = 0.4;

/** How long the disclaimer slide is held after the last line, per the design doc. */
export const disclaimerTailSeconds = 3;

/**
 * The content budget the design doc and TASK-170 fix for this script. The second bound is on
 * `totalSeconds` — the dialogue plus the 3-second tail, which is what the Composition's
 * `durationInFrames` comes from (5400–9000 frames at 30 fps) — not on the dialogue alone: a script
 * with 298 s of dialogue is inside that reading but renders 301 s, one second outside the window.
 * The character bound comes out of the reading rate above (900–1500 characters is 180–300 seconds),
 * and the slide bounds keep a cue on screen for 15–25 seconds.
 */
export const scriptBudget = {
  minCharacters: 900,
  maxCharacters: 1500,
  minTotalSeconds: 180,
  maxTotalSeconds: 300,
  minLines: 10,
  maxLines: 20,
  minSlideSeconds: 15,
  maxSlideSeconds: 25,
} as const;

/**
 * Length in Unicode code points, not UTF-16 units: every kana and kanji here is one code point, and
 * the rate counts characters rather than grapheme clusters or bytes.
 */
export const codePointLength = (text: string): number => Array.from(text).length;

/** The script's only timing authority: how many seconds a line takes to say. */
export const estimateSeconds = (text: string): number =>
  Math.ceil(codePointLength(text) / codePointsPerSecond);

/** The six expressions a line can carry; `Speakers.tsx` draws each as a reaction beside the face. */
export const expressionSchema = z.enum([
  'normal',
  'happy',
  'surprised',
  'thinking',
  'wink',
  'serious',
]);

export type Expression = z.infer<typeof expressionSchema>;

/** A chapter's headline: what the chapter chip and the scene's own heading show. */
const headline = z.string().min(1);

/**
 * What is on screen behind a line. Consecutive lines that carry the same cue share one scene, so the
 * cue *is* the scene: `groupSlides` never needs a separate slide id. Each kind is one designed scene
 * with its own data — the numbers a scene animates are written here, next to the narration that
 * names them, and the scene derives everything else from them (`scenes/math.ts`).
 */
export const slideCueSchema = z.discriminatedUnion('kind', [
  /** The cold open: the title, a kicker above it, and the chapters the video walks through. */
  z.object({
    kind: z.literal('title'),
    text: z.string().min(1),
    kicker: z.string().min(1),
    agenda: z.array(z.string().min(1)).min(2).max(8),
  }),
  /** Many companies fold into one index line, and a fund follows that line. */
  z.object({
    kind: z.literal('index'),
    title: headline,
    constituents: z.int().min(20).max(500),
    indexLabel: z.string().min(1),
    fundLabel: z.string().min(1),
    takeaway: z.string().min(1),
  }),
  /** One basket against many: the same shock, two outcomes, then the snack-box analogy. */
  z.object({
    kind: z.literal('spread'),
    title: headline,
    companies: z.int().min(4).max(64),
    concentrated: z.string().min(1),
    diversified: z.string().min(1),
    analogy: z.string().min(1),
  }),
  /** A long series drawn on, its valleys marked, and every year's return under it. */
  z.object({
    kind: z.literal('chart'),
    title: headline,
    chartId: z.string().min(1),
    caption: z.string().min(1),
  }),
  /** The same growth under two yearly fees, compounded side by side. */
  z.object({
    kind: z.literal('cost'),
    title: headline,
    principal: z.number().positive(),
    years: z.int().min(5).max(50),
    growth: z.number().positive().max(0.2),
    fees: z.object({ low: z.number().nonnegative(), high: z.number().positive() }),
    note: z.string().min(1),
  }),
  /** The three watchwords, then a fixed monthly amount buying through a moving price. */
  z.object({
    kind: z.literal('instalment'),
    title: headline,
    pillars: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
    monthly: z.number().positive(),
    prices: z.array(z.number().positive()).min(6).max(24),
    takeaway: z.string().min(1),
  }),
  /** The worst fall of a series, how long it stayed under water, and what selling at the bottom does. */
  z.object({
    kind: z.literal('risk'),
    title: headline,
    chartId: z.string().min(1),
    warnings: z.array(z.string().min(1)).min(1).max(3),
  }),
  /** Money that may be invested against money that may not, and the question to ask oneself. */
  z.object({
    kind: z.literal('scope'),
    title: headline,
    near: z.object({ label: z.string().min(1), detail: z.string().min(1) }),
    far: z.object({ label: z.string().min(1), detail: z.string().min(1) }),
    question: z.string().min(1),
  }),
  /** The checklist the video leaves behind. */
  z.object({
    kind: z.literal('summary'),
    title: headline,
    items: z.array(z.string().min(1)).min(2).max(5),
    closing: z.string().min(1),
  }),
  z.object({ kind: z.literal('disclaimer'), text: z.string().min(1) }),
]);

export type SlideCue = z.infer<typeof slideCueSchema>;

/**
 * One spoken line. `id` is the stable key: it keys the subtitle `Sequence`s, the narration track
 * and, once VOICEVOX audio exists, the entry in the generated `assets.local/voice/durations.json`.
 * `text` carries no speaker prefix, because the speaker is a separate field.
 */
export const scriptLineSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lower-case kebab-case'),
    speaker: z.enum(['zundamon', 'metan']),
    text: z.string().min(1),
    expression: expressionSchema,
    slide: slideCueSchema,
    seconds: z.int().positive(),
    /** Words the subtitle paints in the highlight colour; each one occurs in `text`. */
    emphasis: z.array(z.string().min(1)).default([]),
  })
  .superRefine((line, ctx) => {
    line.emphasis.forEach((word, index) => {
      if (!line.text.includes(word)) {
        ctx.addIssue({
          code: 'custom',
          path: ['emphasis', index],
          message: `${word} does not occur in the line`,
        });
      }
    });
    const expected = estimateSeconds(line.text);
    if (line.seconds !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['seconds'],
        message: `${codePointLength(line.text)} code points at ${codePointsPerSecond}/s is ${expected} s, not ${line.seconds} s`,
      });
    }
  });

export type ScriptLine = z.infer<typeof scriptLineSchema>;

/** A line as `script.ts` writes it, before the schema fills `emphasis` in. */
export type ScriptLineInput = z.input<typeof scriptLineSchema>;

/**
 * A line's sentences, each with its terminal punctuation: what one subtitle card shows and what one
 * synthesized voice clip says. A line with no terminal punctuation is one sentence.
 */
export const splitSentences = (text: string): readonly string[] =>
  text
    .split(/(?<=[。！？!?])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/**
 * The whole script. Two structural rules live here rather than in `scriptIssues`, because they are
 * part of the format: ids are unique, and the last slide is the disclaimer, whose text is the
 * script's own `disclaimer` (so the slide and the data cannot drift apart).
 */
export const scriptSchema = z
  .object({
    title: z.string().min(1),
    disclaimer: z.string().min(1),
    lines: z.array(scriptLineSchema).min(1),
  })
  .superRefine((script, ctx) => {
    const seen = new Set<string>();
    script.lines.forEach((line, index) => {
      if (seen.has(line.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'id'],
          message: `duplicate id ${line.id}`,
        });
      }
      seen.add(line.id);
    });
    const last = script.lines.at(-1);
    if (last === undefined) return;
    if (last.slide.kind !== 'disclaimer') {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', script.lines.length - 1, 'slide'],
        message: 'the last line carries the disclaimer slide',
      });
    } else if (last.slide.text !== script.disclaimer) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', script.lines.length - 1, 'slide', 'text'],
        message: 'the disclaimer slide repeats script.disclaimer verbatim',
      });
    }
  });

export type Script = z.infer<typeof scriptSchema>;

// ---------------------------------------------------------------------------------------------
// Timing, as pure functions over the validated data. All of it is arithmetic on the line seconds:
// no clock, no randomness, so the video and the test compute the same numbers every run.
// ---------------------------------------------------------------------------------------------

/** Where each line starts, as the cumulative sum of the lines before it. */
export const lineStartTimes = (lines: readonly ScriptLine[]): readonly number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.seconds;
  }
  return starts;
};

/** Every line's seconds added up: the dialogue half of the video. */
export const dialogueSeconds = (lines: readonly ScriptLine[]): number =>
  lines.reduce((total, line) => total + line.seconds, 0);

/** The dialogue total plus the held disclaimer tail: what the Composition's duration comes from. */
export const totalSeconds = (lines: readonly ScriptLine[]): number =>
  dialogueSeconds(lines) + disclaimerTailSeconds;

/** A slide is a run of consecutive lines that carry the same cue. */
export type SlideGroup = {
  readonly cue: SlideCue;
  readonly lines: readonly ScriptLine[];
};

/** Structural identity of a cue: two lines are on the same slide when their cues are equal. */
export const cueKey = (cue: SlideCue): string => JSON.stringify(cue);

/** Run-consecutive lines into slides. Never merges two runs that share a cue but are not adjacent. */
export const groupSlides = (lines: readonly ScriptLine[]): readonly SlideGroup[] => {
  const groups: { cue: SlideCue; lines: ScriptLine[] }[] = [];
  for (const line of lines) {
    const current = groups.at(-1);
    if (current !== undefined && cueKey(current.cue) === cueKey(line.slide)) {
      current.lines.push(line);
      continue;
    }
    groups.push({ cue: line.slide, lines: [line] });
  }
  return groups;
};

/**
 * What each `TransitionScene` declares: the slide's lines, plus the 0.4 s crossfade it pays for on
 * its way out. The last slide has nothing to cross to, so it declares no overlap.
 */
export const slideSceneSeconds = (groups: readonly SlideGroup[]): readonly number[] =>
  groups.map(
    (group, index) =>
      dialogueSeconds(group.lines) + (index === groups.length - 1 ? 0 : slideOverlapSeconds),
  );

/** All the crossfades in one `TransitionSeries`: 0.4 s per adjacent pair. */
export const transitionOverlapSeconds = (slideCount: number): number =>
  slideOverlapSeconds * Math.max(0, slideCount - 1);

/**
 * The `TransitionSeries` total: the scene durations minus every overlap, which telescopes back to
 * the dialogue total. Rounded to milliseconds because 0.4 is not exact in binary floating point.
 */
export const seriesSeconds = (groups: readonly SlideGroup[]): number => {
  const scenes = slideSceneSeconds(groups).reduce((total, seconds) => total + seconds, 0);
  return Math.round((scenes - transitionOverlapSeconds(groups.length)) * 1000) / 1000;
};

/**
 * Where each slide starts. Slide `i` starts exactly at its first line, because its predecessor's
 * outgoing overlap is what pays for the crossfade (see `nextSlideStart`).
 */
export const slideStartSeconds = (groups: readonly SlideGroup[]): readonly number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const group of groups) {
    starts.push(at);
    at += dialogueSeconds(group.lines);
  }
  return starts;
};

/**
 * The same starts, computed the way a `TransitionSeries` walks its scenes: add a scene's declared
 * duration, then take back the overlap. It has to land on `slideStartSeconds` — the test holds the
 * two definitions together, which is what says a crossfade never shifts the dialogue.
 */
export const slideStartsFromSeries = (groups: readonly SlideGroup[]): readonly number[] => {
  const scenes = slideSceneSeconds(groups);
  const starts: number[] = [];
  let at = 0;
  scenes.forEach((seconds, index) => {
    starts.push(Math.round(at * 1000) / 1000);
    if (index < scenes.length - 1) at += seconds - slideOverlapSeconds;
  });
  return starts;
};

/** One slide's timing, ready for a `TransitionScene` and for a test to read. */
export type SlideSpan = {
  readonly index: number;
  readonly cue: SlideCue;
  readonly lines: readonly ScriptLine[];
  /** The first line's start: no slide is ever late. */
  readonly startSeconds: number;
  /** Its lines added up. */
  readonly dialogueSeconds: number;
  /** What the `TransitionScene` declares: the dialogue plus its outgoing overlap. */
  readonly sceneSeconds: number;
  /** How long the slide is on screen: the dialogue, plus the held tail on the last slide. */
  readonly onScreenSeconds: number;
};

/** Group, time and lay out every slide of a script. The one function an example needs. */
export const slidePlan = (lines: readonly ScriptLine[]): readonly SlideSpan[] => {
  const groups = groupSlides(lines);
  const starts = slideStartSeconds(groups);
  const scenes = slideSceneSeconds(groups);
  return groups.map((group, index) => {
    const spoken = dialogueSeconds(group.lines);
    return {
      index,
      cue: group.cue,
      lines: group.lines,
      startSeconds: starts[index] ?? 0,
      dialogueSeconds: spoken,
      sceneSeconds: scenes[index] ?? 0,
      onScreenSeconds: spoken + (index === groups.length - 1 ? disclaimerTailSeconds : 0),
    };
  });
};

/** The numbers a reviewer asks about: characters, seconds, lines and slides. */
export type ScriptStats = {
  readonly characters: number;
  readonly dialogueSeconds: number;
  readonly totalSeconds: number;
  readonly lineCount: number;
  readonly slideCount: number;
  readonly slideOnScreenSeconds: readonly number[];
};

export const scriptStats = (script: Script): ScriptStats => {
  const spans = slidePlan(script.lines);
  return {
    characters: script.lines.reduce((total, line) => total + codePointLength(line.text), 0),
    dialogueSeconds: dialogueSeconds(script.lines),
    totalSeconds: totalSeconds(script.lines),
    lineCount: script.lines.length,
    slideCount: spans.length,
    slideOnScreenSeconds: spans.map((span) => span.onScreenSeconds),
  };
};

/**
 * The content budget as a list of problems, empty when the script is inside it. The schema cannot
 * carry these: they are bounds on the whole script (characters, the total seconds the Composition is
 * built from, lines, cue cadence) rather than on one field, and a script that misses them still
 * parses.
 */
export const scriptIssues = (script: Script): readonly string[] => {
  const stats = scriptStats(script);
  const issues: string[] = [];
  const {
    characters,
    dialogueSeconds: spoken,
    totalSeconds: total,
    lineCount,
    slideOnScreenSeconds,
  } = stats;
  if (characters < scriptBudget.minCharacters || characters > scriptBudget.maxCharacters) {
    issues.push(
      `${characters} characters is outside ${scriptBudget.minCharacters}-${scriptBudget.maxCharacters}`,
    );
  }
  // The whole timeline is the contract, not the dialogue: the tail is rendered too.
  if (total < scriptBudget.minTotalSeconds || total > scriptBudget.maxTotalSeconds) {
    issues.push(
      `${total} s in total (${spoken} s of dialogue plus the ${disclaimerTailSeconds} s tail) is outside ${scriptBudget.minTotalSeconds}-${scriptBudget.maxTotalSeconds}`,
    );
  }
  if (lineCount < scriptBudget.minLines || lineCount > scriptBudget.maxLines) {
    issues.push(`${lineCount} lines is outside ${scriptBudget.minLines}-${scriptBudget.maxLines}`);
  }
  slideOnScreenSeconds.forEach((seconds, index) => {
    if (seconds < scriptBudget.minSlideSeconds || seconds > scriptBudget.maxSlideSeconds) {
      issues.push(
        `slide ${index} is on screen for ${seconds} s, outside ${scriptBudget.minSlideSeconds}-${scriptBudget.maxSlideSeconds}`,
      );
    }
  });
  return issues;
};

/** Validate against the budget and fail loudly: `script.ts` calls this once, at module load. */
export const assertScript = (script: Script): Script => {
  const issues = scriptIssues(script);
  if (issues.length > 0) {
    throw new Error(`explainer script: ${issues.join('; ')}`);
  }
  return script;
};
