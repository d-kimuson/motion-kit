// The explainer's layout test: every subtitle sentence fits the plate, every sentence stays up long
// enough to read, and the regions every layer draws in never overlap. All of it is the same
// arithmetic the components read (`layout.ts`, `look.ts`), so a longer script line or a moved region
// fails here rather than in a frame.
import { describe, expect, it } from 'vitest';

import {
  SUBTITLE_TEXT_HEIGHT,
  SUBTITLE_TEXT_WIDTH,
  advanceEm,
  emphasisRuns,
  phrases,
  subtitleFit,
} from './layout.ts';
import {
  type CHARACTERS,
  DESIGN,
  PORTRAIT_HEIGHT,
  PORTRAIT_TOP,
  SCENE_BODY,
  STAGE,
  SUBTITLE,
  SUBTITLE_LINES,
  SUBTITLE_MAX_LINES,
  SUBTITLE_MIN_SIZE,
  TOP_BAR,
  portraitAspect,
  portraitCentre,
  portraitInk,
  type Box,
} from './look.ts';
import { ciStoryboard, explainerStoryboard, FPS } from './plan.ts';

const sentences = [explainerStoryboard(FPS), ciStoryboard()].flatMap((board) =>
  board.lines.flatMap((line) => line.sentences),
);

const bottom = (box: Box): number => box.top + box.height;
const right = (box: Box): number => box.left + box.width;

/** What each portrait draws, as a horizontal span in the design space. */
const portraitSpan = (character: (typeof CHARACTERS)[number]) => {
  const width = PORTRAIT_HEIGHT * portraitAspect[character];
  const box = portraitCentre[character] - width / 2;
  return {
    left: box + width * portraitInk[character].left,
    right: box + width * portraitInk[character].right,
  };
};

describe('explainer subtitles', () => {
  it('sets every sentence inside the plate, on two lines wherever two lines can hold it', () => {
    const overflowing = sentences.filter((sentence) => {
      const fit = subtitleFit(sentence.text, sentence.emphasis);
      return (
        fit.lines.join('') !== sentence.text ||
        fit.lines.some((line) => advanceEm(line) * fit.size > SUBTITLE_TEXT_WIDTH) ||
        fit.lines.length > SUBTITLE_MAX_LINES ||
        fit.lines.length * fit.size * fit.lineHeight > SUBTITLE_TEXT_HEIGHT ||
        (fit.lines.length <= SUBTITLE_LINES && fit.size < SUBTITLE_MIN_SIZE)
      );
    });
    expect(overflowing.map((sentence) => sentence.text)).toEqual([]);
    // The script has exactly one sentence too long for two lines; it still reads at 48 px.
    const three = sentences
      .map((sentence) => subtitleFit(sentence.text, sentence.emphasis))
      .filter((fit) => fit.lines.length === 3);
    expect(three.map((fit) => fit.size)).toEqual([48]);
  });

  it('breaks a line only between phrases, never inside an emphasised word', () => {
    // A particle ends a phrase only before a word; okurigana never does (`上がり続ける` stays whole).
    expect(phrases('値段はずっと上がり続けるわけではないのだ。')).toEqual([
      '値段はずっと',
      '上がり続けるわけではないのだ。',
    ]);
    // A demonstrative stays with its noun, and a word in `keep` is never cut.
    expect(phrases('実はこの方法に向いていない')).toEqual(['実はこの方法に', '向いていない']);
    expect(phrases('投資の基本は、ひとつの会社に頼る', ['ひとつの会社に頼る'])).toEqual([
      '投資の',
      '基本は、',
      'ひとつの会社に頼る',
    ]);
    // Every line of every subtitle is whole phrases of its sentence.
    const split = sentences.filter((sentence) => {
      const cuts = new Set<number>();
      let end = 0;
      for (const phrase of phrases(sentence.text, sentence.emphasis))
        cuts.add((end += phrase.length));
      let at = 0;
      return subtitleFit(sentence.text, sentence.emphasis).lines.some(
        (line) => !cuts.has((at += line.length)),
      );
    });
    expect(split.map((sentence) => sentence.text)).toEqual([]);
  });

  it('keeps every narrated sentence on screen for at least a second and a half', () => {
    // The full storyboard only: `explainer-ci` squeezes one line into 24 frames on purpose.
    const brief = explainerStoryboard(FPS)
      .lines.flatMap((line) => line.sentences)
      .filter((sentence) => sentence.frames < 45);
    expect(brief.map((sentence) => sentence.text)).toEqual([]);
  });

  it('cuts a sentence at its emphasised words, the longest word winning an overlap', () => {
    const runs = emphasisRuns('長期・積立・分散が合言葉', ['積立', '長期・積立']);
    expect(runs).toEqual([
      { text: '長期・積立', emphasis: true },
      { text: '・分散が合言葉', emphasis: false },
    ]);
    // Cutting never loses a character: the runs join back to the sentence.
    const rejoined = sentences.map((sentence) =>
      emphasisRuns(sentence.text, sentence.emphasis)
        .map((run) => run.text)
        .join(''),
    );
    expect(rejoined).toEqual(sentences.map((sentence) => sentence.text));
    expect(emphasisRuns('なにもない', [])).toEqual([{ text: 'なにもない', emphasis: false }]);
  });
});

describe('explainer regions', () => {
  it('stacks the top bar, the stage and the subtitle box inside the frame without overlap', () => {
    for (const box of [TOP_BAR, STAGE, SUBTITLE]) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(right(box)).toBeLessThanOrEqual(DESIGN.width);
      expect(bottom(box)).toBeLessThanOrEqual(DESIGN.height);
    }
    expect(bottom(TOP_BAR)).toBeLessThan(STAGE.top);
    expect(bottom(STAGE)).toBeLessThan(SUBTITLE.top);
    expect(right(SCENE_BODY)).toBeLessThanOrEqual(STAGE.width);
    expect(bottom(SCENE_BODY)).toBeLessThanOrEqual(STAGE.height);
  });

  it('keeps what each portrait draws in its side lane, inside the frame and clear of the scene body', () => {
    const bodyLeft = STAGE.left + SCENE_BODY.left;
    const bodyRight = bodyLeft + SCENE_BODY.width;
    const metan = portraitSpan('metan');
    const zundamon = portraitSpan('zundamon');
    expect(metan.left).toBeGreaterThanOrEqual(0);
    expect(metan.right).toBeLessThan(bodyLeft);
    expect(zundamon.left).toBeGreaterThan(bodyRight);
    expect(zundamon.right).toBeLessThanOrEqual(DESIGN.width);
    expect(PORTRAIT_TOP).toBeGreaterThan(STAGE.top);
  });
});
