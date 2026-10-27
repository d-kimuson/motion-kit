// The explainer's layout test: every slide stays inside the body box, and every subtitle line fits
// the plate. Both are the shared safe area (`look.ts`) read back — the same numbers the components
// read — so a longer script line, a bigger title or a new slide fails here rather than in a frame.
import { describe, expect, it } from 'vitest';

import {
  bodyFontSize,
  bulletsLayout,
  chartLayout,
  disclaimerLayout,
  lineCount,
  titleLayout,
} from './layout.ts';
import {
  BODY_LINES,
  BODY_LINE_HEIGHT,
  BODY_MIN_SIZE,
  BODY_SIZE,
  NAME_LINE_HEIGHT,
  NAME_SIZE,
  px,
  safeArea,
  type SafeArea,
} from './look.ts';
import { slidePlan } from './script.schema.ts';
import { script } from './script.ts';

/** The three sizes the example renders at: the full video, `explainer-ci`, and the probe. */
const frames = [
  { width: 1920, height: 1080 },
  { width: 960, height: 540 },
  { width: 480, height: 270 },
] as const;

const cues = slidePlan(script.lines).map((span) => span.cue);

/** Every block a cue stacks, with the name `layout.test.ts` reports it by. */
const blocks = (area: SafeArea, cue: (typeof cues)[number]) => {
  switch (cue.kind) {
    case 'title': {
      const box = titleLayout(area, cue.text);
      return [
        ['eyebrow', box.eyebrow],
        ['title', box.title],
        ['rule', { top: box.rule, height: Math.max(2, px(area.height * 0.005)) }],
        ['tagline', box.tagline],
      ] as const;
    }
    case 'bullets': {
      const box = bulletsLayout(area, cue, '02');
      return [
        ['eyebrow', box.eyebrow],
        ['title', box.title],
        ['rule', { top: box.rule, height: Math.max(2, px(area.height * 0.0042)) }],
        ...box.items.map((item, index) => [`item-${String(index)}`, item] as const),
        ...(box.trailing === null
          ? []
          : [
              [
                'trailing',
                { top: box.trailing, height: Math.max(1, px(area.height * 0.0016)) },
              ] as const,
            ]),
      ] as const;
    }
    case 'chart': {
      const box = chartLayout(area, cue.caption);
      return [
        ['rule', { top: box.rule, height: Math.max(2, px(area.height * 0.004)) }],
        ['caption', box.caption],
        ['card', { top: box.card.top, height: box.card.height }],
      ] as const;
    }
    case 'disclaimer': {
      const box = disclaimerLayout(area, cue.text);
      return [
        ['eyebrow', box.eyebrow],
        ['text', box.text],
        ...box.credits.map((credit, index) => [`credit-${String(index)}`, credit] as const),
      ] as const;
    }
    default:
      return [] as const;
  }
};

describe('explainer safe area', () => {
  it('puts the body, the plate and the two character lanes in one non-overlapping frame', () => {
    for (const frame of frames) {
      const area = safeArea(frame.width, frame.height);
      // The body ends at least a gap above the plate, and the plate clears the frame's own margin.
      expect(area.bodyTop).toBeGreaterThan(0);
      expect(area.bodyTop).toBeLessThan(area.bodyBottom);
      expect(area.bodyBottom).toBeLessThan(area.bandTop);
      expect(area.bandTop + area.bandHeight).toBeLessThanOrEqual(frame.height);
      // The text column sits between the lanes: no sprite can paint over a slide's text.
      expect(area.textLeft).toBeGreaterThanOrEqual(area.spriteLeft + area.spriteWidth);
      expect(area.textLeft + area.textWidth).toBeLessThanOrEqual(area.spriteRight);
      // The characters stand on the plate: their feet are behind it, their heads above it.
      expect(area.spriteTop).toBeLessThan(area.bandTop);
      expect(area.spriteTop + area.spriteHeight).toBeGreaterThan(area.bandTop);
      expect(area.spriteTop).toBeGreaterThanOrEqual(area.bodyTop);
    }
  });

  it('stacks every slide of the script inside the body, above the plate', () => {
    const outside: string[] = [];
    for (const frame of frames) {
      const area = safeArea(frame.width, frame.height);
      for (const cue of cues) {
        for (const [name, block] of blocks(area, cue)) {
          if (block.top < area.bodyTop || block.top + block.height > area.bodyBottom)
            outside.push(
              `${cue.kind}/${name} at ${String(frame.width)}x${String(frame.height)}: ${String(block.top)}..${String(block.top + block.height)}`,
            );
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('leaves the plate room for its name line and every reserved body line', () => {
    for (const frame of frames) {
      const area = safeArea(frame.width, frame.height);
      const name = px(frame.height * NAME_SIZE) * NAME_LINE_HEIGHT;
      const body = px(frame.height * BODY_SIZE) * BODY_LINE_HEIGHT * BODY_LINES;
      // The plate is a fixed height: a line that needs more rows shrinks instead of growing it.
      expect(name + body).toBeLessThanOrEqual(area.bandHeight - 2 * area.bandPaddingY);
    }
  });

  it('draws every script line in the reserved lines, shrinking a long one from 72 px', () => {
    const shrink: string[] = [];
    for (const frame of frames) {
      const area = safeArea(frame.width, frame.height);
      const target = px(frame.height * BODY_SIZE);
      for (const line of script.lines) {
        const size = bodyFontSize(line.text, area, target);
        expect(size).toBeLessThanOrEqual(target);
        expect(size).toBeGreaterThanOrEqual(px(frame.height * BODY_MIN_SIZE));
        expect(lineCount(line.text, area.bandInnerWidth, size)).toBeLessThanOrEqual(BODY_LINES);
        if (size < target) shrink.push(`${line.id}@${String(frame.height)}:${String(size)}`);
      }
      // Only the longest lines are allowed to shrink, and only a little: a typical line is 72 px.
      expect(
        script.lines.filter((line) => bodyFontSize(line.text, area, target) === target).length,
      ).toBeGreaterThan(script.lines.length / 2);
    }
    // The two 14-second lines are the ones the band's 72 px cannot hold in three lines.
    expect(shrink.filter((entry) => entry.endsWith(':72'))).toEqual([]);
  });

  it('fits the chart into the body instead of letting it run under the plate', () => {
    const frame = frames[0];
    const area = safeArea(frame.width, frame.height);
    const cue = cues.find((item) => item.kind === 'chart');
    expect(cue).toBeDefined();
    if (cue === undefined || cue.kind !== 'chart') return;
    const box = chartLayout(area, cue.caption);
    expect(box.card.top).toBeGreaterThanOrEqual(area.bodyTop);
    expect(box.card.top + box.card.height).toBeLessThanOrEqual(area.bodyBottom);
    expect(box.card.left).toBeGreaterThanOrEqual(area.textLeft);
    expect(box.card.left + box.card.width).toBeLessThanOrEqual(area.textLeft + area.textWidth);
    // The chart's own frame is scaled down and shifted up and left, so the content box it draws in
    // lands on the card and only the empty margins are clipped.
    expect(box.card.scale).toBeLessThan(1);
    expect(box.card.offsetX).toBeLessThan(0);
    expect(box.card.offsetY).toBeLessThan(0);
    expect(-box.card.offsetY + box.card.height).toBeLessThanOrEqual(frame.height);
    expect(-box.card.offsetX + box.card.width).toBeLessThanOrEqual(frame.width);
  });
});
