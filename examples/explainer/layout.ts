// The explainer's vertical layout: what each slide stacks inside the body box and what the subtitle
// plate reserves for a line. Pure arithmetic on the frame size and the script's own strings, so a
// slide cannot place a block under the band and a line cannot outgrow the plate.
//
// A slide stacks from `safeArea().bodyTop` downwards with a cursor (`stacker`), and every block's
// height comes from its text (`block`): a title that wraps to two lines pushes what follows it down
// instead of painting over it, and a stack that would pass `bodyBottom` is what `layout.test.ts`
// walks every cue looking for. The band reverses the rule: its height is fixed, and the body size
// shrinks from 72 px (`BODY_SIZE`) until the longest line fits `BODY_LINES` of them.
import { BODY_LINES, BODY_MIN_SIZE, CREDITS, px, type SafeArea } from './look.ts';

/**
 * A text run's width in em, from the code points: a Japanese glyph advances about 1 em, a Latin one
 * about 0.55, and letter-spaced text adds the tracking the plates set (0.06 em). The estimate is the
 * widest a run can be, so a real line never wraps into more lines than the layout reserved — a long
 * Latin run is the case it over-counts, and over-counting only costs a little air.
 */
const TRACKING = 1.06;
const FULL_EM = 1;
const HALF_EM = 0.55;

const isFullWidth = (char: string): boolean => (char.codePointAt(0) ?? 0) >= 0x2000;

/** A run's width in em. `codePoints`, not `length`, so a surrogate pair counts once. */
export const advanceEm = (text: string): number => {
  let em = 0;
  for (const char of text) em += (isFullWidth(char) ? FULL_EM : HALF_EM) * TRACKING;
  return em;
};

/** How many lines `text` wraps to in `width` px at `size` px. At least one. */
export const lineCount = (text: string, width: number, size: number): number =>
  Math.max(1, Math.ceil((advanceEm(text) * size) / Math.max(1, width)));

/** The body size a subtitle line is drawn at: `target`, shrunk until it fits `lines` plate lines. */
export const fitSize = (
  text: string,
  width: number,
  target: number,
  lines: number,
  floor: number,
): number => {
  let size = px(target);
  const lowest = Math.max(1, px(floor));
  while (size > lowest && lineCount(text, width, size) > lines) size -= 1;
  return size;
};

/** The body size a line's subtitle is drawn at, in the plate it is given. */
export const bodyFontSize = (text: string, area: SafeArea, target: number): number =>
  fitSize(text, area.bandInnerWidth, target, BODY_LINES, px(area.height * BODY_MIN_SIZE));

/** Where one stacked block starts, how tall it is, and the type the component sets it in. */
export type Block = {
  readonly top: number;
  readonly height: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly lines: number;
};

/** A vertical cursor: `place` returns a block's top and moves past it, `skip` moves over a gap. */
export type Stacker = {
  readonly at: number;
  readonly place: (height: number) => number;
  readonly skip: (gap: number) => void;
};

export const stacker = (top: number): Stacker => {
  let at = top;
  return {
    get at() {
      return at;
    },
    place(height) {
      const start = at;
      at += Math.max(0, Math.round(height));
      return start;
    },
    skip(gap) {
      at += Math.max(0, Math.round(gap));
    },
  };
};

/** Stack one text run: its height is its own line count, so a wrapped line pushes the next down. */
const block = (
  flow: Stacker,
  text: string,
  width: number,
  size: number,
  lineHeight: number,
  gapAfter = 0,
): Block => {
  const lines = lineCount(text, width, size);
  const height = Math.ceil(size * lineHeight) * lines;
  const top = flow.place(height);
  flow.skip(gapAfter);
  return { top, height, size, lineHeight, lines };
};

/** A block stacked without any text: an accent rule, a chart card. */
const plain = (flow: Stacker, height: number, gapAfter = 0): number => {
  const top = flow.place(height);
  flow.skip(gapAfter);
  return top;
};

/** The last row a stack actually paints, which is what has to clear `area.bodyBottom`. */
const painted = (...bottoms: readonly number[]): number => Math.max(...bottoms);

const footOf = (item: Block): number => item.top + item.height;

/** The rule under a slide's heading, and the rule that closes a bullet list. */
const ruleHeight = (height: number): number => Math.max(2, px(height * 0.0042));

/** The opening slide's tagline: the one line of copy the slide carries that the script does not. */
export const TAGLINE = 'ずんだもんと四国めたんが、やさしく整理します。';

export type TitleLayout = {
  readonly eyebrow: Block;
  readonly title: Block;
  readonly rule: number;
  readonly tagline: Block;
  /** The stack's last row: at most `area.bodyBottom`. */
  readonly bottom: number;
};

export const titleLayout = (area: SafeArea, text: string): TitleLayout => {
  const { height } = area;
  const flow = stacker(area.bodyTop);
  const eyebrow = block(
    flow,
    'INDEX INVESTING',
    area.textWidth,
    px(height * 0.024),
    1.4,
    px(height * 0.055),
  );
  const titleSize = fitSize(text, area.textWidth, height * 0.098, 1, height * 0.055);
  const title = block(flow, text, area.textWidth, titleSize, 1.18, px(height * 0.05));
  const rule = plain(flow, Math.max(2, px(height * 0.005)), px(height * 0.04));
  const tagline = block(flow, TAGLINE, area.textWidth, px(height * 0.032), 1.6);
  return { eyebrow, title, rule, tagline, bottom: footOf(tagline) };
};

export type BulletsLayout = {
  readonly eyebrow: Block;
  readonly title: Block;
  readonly rule: number;
  readonly items: readonly Block[];
  /** The bullet square and its gap to the item's text, and the width the text wraps in. */
  readonly bullet: number;
  readonly bulletGap: number;
  readonly itemWidth: number;
  /** The closing rule, when the list leaves room for it; `null` instead of painting over the band. */
  readonly trailing: number | null;
  readonly bottom: number;
};

export const bulletsLayout = (
  area: SafeArea,
  cue: { readonly title: string; readonly items: readonly string[] },
  number: string,
): BulletsLayout => {
  const { height } = area;
  const bullet = px(height * 0.016);
  const bulletGap = px(area.width * 0.016);
  const itemWidth = area.textWidth - bullet - bulletGap;
  const flow = stacker(area.bodyTop);
  const eyebrow = block(flow, number, area.textWidth, px(height * 0.022), 1.4, px(height * 0.05));
  const titleSize = fitSize(cue.title, area.textWidth, height * 0.062, 1, height * 0.05);
  const title = block(flow, cue.title, area.textWidth, titleSize, 1.3, px(height * 0.03));
  const rule = plain(flow, ruleHeight(height), px(height * 0.045));
  const items = cue.items.map((item) =>
    block(flow, item, itemWidth, px(height * 0.044), 1.35, px(height * 0.028)),
  );
  const trailingHeight = Math.max(1, px(height * 0.0016));
  const trailingTop = flow.at + px(height * 0.02);
  const trailing = trailingTop + trailingHeight <= area.bodyBottom ? trailingTop : null;
  return {
    eyebrow,
    title,
    rule,
    items,
    bullet,
    bulletGap,
    itemWidth,
    trailing,
    bottom: painted(...items.map(footOf), trailing === null ? 0 : trailing + trailingHeight),
  };
};

export type DisclaimerLayout = {
  readonly eyebrow: Block;
  readonly text: Block;
  readonly credits: readonly Block[];
  readonly bottom: number;
};

export const disclaimerLayout = (area: SafeArea, text: string): DisclaimerLayout => {
  const { height } = area;
  const flow = stacker(area.bodyTop);
  const eyebrow = block(
    flow,
    'ご注意',
    area.textWidth,
    px(height * 0.028),
    1.4,
    px(height * 0.035),
  );
  const body = block(flow, text, area.textWidth, px(height * 0.038), 1.7, px(height * 0.05));
  const size = px(height * 0.0215);
  const credits = CREDITS.map((credit) => block(flow, credit, area.textWidth, size, 1.8));
  return { eyebrow, text: body, credits, bottom: painted(footOf(body), ...credits.map(footOf)) };
};

/**
 * The chart slide's card: the chart example's own component, drawn into the body box.
 *
 * `ChartScene` lays itself out in fractions of the *Composition*, so its plot and its year labels
 * run to 0.96 of the frame height — straight under the plate. The slide therefore scales the whole
 * chart down and offsets it so the chart's own content box (`CHART_*`, the outer margins it draws in)
 * fills the card, and clips only the empty margins it leaves outside that box.
 */
const CHART_BOX = { left: 0.062, right: 0.962, top: 0.062, bottom: 0.962 } as const;

export type ChartLayout = {
  readonly rule: number;
  readonly caption: Block;
  /** The card, and the transform that puts the chart's content box inside it. */
  readonly card: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
  readonly bottom: number;
};

export const chartLayout = (area: SafeArea, caption: string): ChartLayout => {
  const { width, height } = area;
  const flow = stacker(area.bodyTop);
  const rule = plain(flow, Math.max(2, px(height * 0.004)), px(height * 0.014));
  const captionBlock = block(
    flow,
    caption,
    area.textWidth,
    px(height * 0.028),
    1.5,
    px(height * 0.016),
  );
  const top = flow.at;
  const cardHeight = Math.max(1, area.bodyBottom - top);
  const scale = cardHeight / ((CHART_BOX.bottom - CHART_BOX.top) * height);
  const cardWidth = Math.round((CHART_BOX.right - CHART_BOX.left) * width * scale);
  return {
    rule,
    caption: captionBlock,
    card: {
      left: area.textLeft,
      top,
      width: cardWidth,
      height: cardHeight,
      scale,
      offsetX: px(-CHART_BOX.left * width * scale),
      offsetY: px(-CHART_BOX.top * height * scale),
    },
    bottom: area.bodyBottom,
  };
};
