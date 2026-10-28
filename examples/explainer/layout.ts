// How a subtitle sentence is set: pure arithmetic on the sentence's own code points, so a sentence
// can never outgrow the subtitle box and `layout.test.ts` can walk every sentence of the script
// without rendering one.
//
// The layout picks the line breaks itself instead of leaving them to the browser. A sentence is cut
// into phrases (`phrases`), the phrases are packed onto as few lines as fit, and among those packings
// the most even one wins (`breakLines`), so a line never ends one kana into a word and the second
// line is never a stub. The box is fixed (`SUBTITLE` in `look.ts`): a sentence is set at
// `SUBTITLE_SIZE` on up to `SUBTITLE_LINES` lines, shrinking towards `SUBTITLE_MIN_SIZE` until it
// fits; only a sentence too long for that gets a third line, set tighter and at the largest size the
// plate's height allows.
import {
  SUBTITLE,
  SUBTITLE_LINES,
  SUBTITLE_MAX_LINES,
  SUBTITLE_LINE_HEIGHT,
  SUBTITLE_MIN_SIZE,
  SUBTITLE_PADDING_BOTTOM,
  SUBTITLE_PADDING_TOP,
  SUBTITLE_PADDING_X,
  SUBTITLE_PLATE_OFFSET,
  SUBTITLE_SIZE,
  SUBTITLE_TIGHT_LINE_HEIGHT,
  px,
} from './look.ts';

/**
 * A text run's width in em, from the code points: a Japanese glyph advances 1 em, a Latin one about
 * 0.55, and the subtitle's tracking adds 0.04 em. The estimate is the widest a run can be, so a line
 * the layout measured never overflows in the browser.
 */
const TRACKING = 1.04;
const FULL_EM = 1;
const HALF_EM = 0.55;

const isFullWidth = (char: string): boolean => (char.codePointAt(0) ?? 0) >= 0x2000;

/** A run's width in em. `for…of` walks code points, so a surrogate pair counts once. */
export const advanceEm = (text: string): number => {
  let em = 0;
  for (const char of text) em += (isFullWidth(char) ? FULL_EM : HALF_EM) * TRACKING;
  return em;
};

/** Hiragana particles a phrase may end on: `投資は|`, `会社を|`, `ペースで|`. */
const PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'も', 'へ', 'や', 'の']);
const OPENING = /[「『（(【〈《“]/u;
const CLOSING = /[」』）)】〉》”、。，．！？!?…]/u;
/** A character a phrase can start with after a particle: kanji, katakana, Latin letters, digits. */
const WORD = /[\p{Script=Han}\p{Script=Katakana}々〆A-Za-z0-9０-９]/u;

/** The shortest phrase a particle may end, so `私の|` never stands alone. */
const MIN_PHRASE = 3;
/** `この` and its kin modify the word after them, so they never end a phrase: `この方法`, `その指数`. */
const DEMONSTRATIVE = /[こそあど]の$/u;

/**
 * `text` cut into phrases — the places a Japanese line may break without splitting a word: after a
 * stop or a closing bracket, before an opening bracket, and after a particle that a kanji, katakana
 * or Latin word follows (`値段は|ずっと|上がり続ける`). Okurigana never ends a phrase, so `考え方`
 * and `上がり続ける` stay whole, and a word in `keep` (the sentence's emphasised words) is never cut.
 */
export const phrases = (text: string, keep: readonly string[] = []): readonly string[] => {
  const chars = Array.from(text);
  const kept = new Set<number>();
  for (const word of keep) {
    const length = Array.from(word).length;
    if (length === 0) continue;
    for (let start = 0; start + length <= chars.length; start += 1)
      if (chars.slice(start, start + length).join('') === word)
        for (let inside = start + 1; inside < start + length; inside += 1) kept.add(inside);
  }
  const out: string[] = [];
  let phrase: string[] = [];
  chars.forEach((char, index) => {
    const previous = chars[index - 1] ?? '';
    const cut =
      phrase.length > 0 &&
      !kept.has(index) &&
      !CLOSING.test(char) &&
      (CLOSING.test(previous) ||
        OPENING.test(char) ||
        (PARTICLES.has(previous) &&
          WORD.test(char) &&
          phrase.length >= MIN_PHRASE &&
          !DEMONSTRATIVE.test(phrase.join(''))));
    if (cut) {
      out.push(phrase.join(''));
      phrase = [];
    }
    phrase.push(char);
  });
  if (phrase.length > 0) out.push(phrase.join(''));
  return out;
};

/** Every way to cut `count` items into `lines` non-empty consecutive groups, as the group sizes. */
const partitions = (count: number, lines: number): readonly (readonly number[])[] => {
  if (lines === 1) return count > 0 ? [[count]] : [];
  const out: (readonly number[])[] = [];
  for (let first = 1; first <= count - lines + 1; first += 1)
    for (const rest of partitions(count - first, lines - 1)) out.push([first, ...rest]);
  return out;
};

/** What a break after a word costs over one after a stop, in em: `持てば、|ひとつの` beats `ひとつの|失敗`. */
const MID_SENTENCE_BREAK = 4;
/** What a stub line costs, in em: a line under `STUB` of the widest one reads as an afterthought. */
const STUB_LINE = 5;
const STUB = 0.4;

/**
 * `text` set on the fewest lines, up to `maxLines`, that each fit `width` px at `size` px, or
 * `undefined` if no packing fits. Among the packings that fit, the most even one wins — a break
 * mid-sentence and a stub line each counting as some em wider. With `split`, a phrase wider than a
 * whole line is cut into its characters; without, such a sentence does not fit.
 */
export const breakLines = (
  text: string,
  keep: readonly string[],
  width: number,
  size: number,
  maxLines: number,
  split = false,
): readonly string[] | undefined => {
  const fits = (line: string): boolean => advanceEm(line) * size <= width;
  const units = phrases(text, keep).flatMap((phrase) =>
    split && !fits(phrase) ? Array.from(phrase) : [phrase],
  );
  for (let lines = 1; lines <= Math.min(maxLines, units.length); lines += 1) {
    let best: { readonly lines: readonly string[]; readonly cost: number } | undefined;
    for (const sizes of partitions(units.length, lines)) {
      let start = 0;
      const set = sizes.map((group) => {
        const line = units.slice(start, start + group).join('');
        start += group;
        return line;
      });
      if (!set.every(fits)) continue;
      const midBreaks = set.slice(0, -1).filter((line) => !CLOSING.test(line.at(-1) ?? '')).length;
      const widest = Math.max(...set.map(advanceEm));
      const stubs = set.filter((line) => advanceEm(line) < STUB * widest).length;
      const cost = widest + MID_SENTENCE_BREAK * midBreaks + STUB_LINE * stubs;
      if (best === undefined || cost < best.cost) best = { lines: set, cost };
    }
    if (best !== undefined) return best.lines;
  }
  return undefined;
};

/** The width a subtitle line may run across: the box less its side padding. */
export const SUBTITLE_TEXT_WIDTH = SUBTITLE.width - 2 * SUBTITLE_PADDING_X;

/** The height the lines may stack to: the plate less its vertical padding. */
export const SUBTITLE_TEXT_HEIGHT =
  SUBTITLE.height - SUBTITLE_PLATE_OFFSET - SUBTITLE_PADDING_TOP - SUBTITLE_PADDING_BOTTOM;

export type SubtitleFit = {
  readonly size: number;
  readonly lines: readonly string[];
  readonly lineHeight: number;
};

/**
 * The size a sentence is set at, the lines it is set on, and the line height it is set with. Whole
 * phrases are tried at every size first; only a sentence no size can set that way has a phrase cut.
 */
export const subtitleFit = (text: string, keep: readonly string[] = []): SubtitleFit =>
  fitWith(text, keep, false) ??
  fitWith(text, keep, true) ?? {
    size: 1,
    lines: [text],
    lineHeight: SUBTITLE_TIGHT_LINE_HEIGHT,
  };

const fitWith = (
  text: string,
  keep: readonly string[],
  split: boolean,
): SubtitleFit | undefined => {
  for (let size = px(SUBTITLE_SIZE); size >= px(SUBTITLE_MIN_SIZE); size -= 1) {
    const lines = breakLines(text, keep, SUBTITLE_TEXT_WIDTH, size, SUBTITLE_LINES, split);
    if (lines !== undefined) return { size, lines, lineHeight: SUBTITLE_LINE_HEIGHT };
  }
  const tallest = Math.floor(
    SUBTITLE_TEXT_HEIGHT / (SUBTITLE_MAX_LINES * SUBTITLE_TIGHT_LINE_HEIGHT),
  );
  for (let size = Math.min(px(SUBTITLE_SIZE), tallest); size > 1; size -= 1) {
    const lines = breakLines(text, keep, SUBTITLE_TEXT_WIDTH, size, SUBTITLE_MAX_LINES, split);
    if (lines !== undefined) return { size, lines, lineHeight: SUBTITLE_TIGHT_LINE_HEIGHT };
  }
  return undefined;
};

/** A sentence cut at its emphasised words, so the subtitle can colour them. */
export type Run = { readonly text: string; readonly emphasis: boolean };

/** Split `text` at every occurrence of each word in `emphasis`; the longest word wins an overlap. */
export const emphasisRuns = (text: string, emphasis: readonly string[]): readonly Run[] => {
  const words = [...emphasis].filter((word) => word !== '').sort((a, b) => b.length - a.length);
  const runs: Run[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const word = words.find((candidate) => text.startsWith(candidate, index));
    if (word === undefined) {
      plain += text[index] ?? '';
      index += 1;
      continue;
    }
    if (plain !== '') runs.push({ text: plain, emphasis: false });
    plain = '';
    runs.push({ text: word, emphasis: true });
    index += word.length;
  }
  if (plain !== '') runs.push({ text: plain, emphasis: false });
  return runs;
};
