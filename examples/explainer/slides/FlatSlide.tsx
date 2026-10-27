// The probe's slide stand-in: the cue's own shape, drawn as opaque rectangles on whole pixels.
//
// It replaces `Slide` under `flat` (`ExplainerScene`) and keeps what the gate is here to watch — the
// cue still selects the geometry, so a title, a bullets slide with `n` items, a chart block and a
// disclaimer still differ frame to frame, and the `TransitionSeries` still places each of them. What
// it drops is everything a platform rasterises their own way: the glyphs, the fractional opacity of
// the entrance, the border radius and the SVG the chart slide composes. `progress` is not read: a
// probe has no partial-arrival state, so nothing here can fade between two frames.
//
// The rows come from the same layout the real slides stack with (`layout.ts`), so the probe's blocks
// sit in the shared body box too and nothing here can reach the subtitle plate below it.
import { useTimeline } from '@kimuson/motion-kit';

import { FlatRect } from '../flat.tsx';
import {
  bulletsLayout,
  chartLayout,
  disclaimerLayout,
  titleLayout,
  type Block,
} from '../layout.ts';
import { ACCENT, GROUND, INK, MUTED, RULE, px, safeArea } from '../look.ts';
import { type PlannedSlide } from '../plan.ts';

type Bar = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
};

/** One block of a layout as a bar: the block's own rows, and a width the cue's text decides. */
const blockBar = (left: number, item: Block, width: number, color: string): Bar => ({
  left,
  top: item.top,
  width: Math.max(2, Math.round(width)),
  height: Math.max(2, item.height),
  color,
});

/** A rule or a card: no text, so the caller names every row. */
const plainBar = (
  left: number,
  top: number,
  width: number,
  height: number,
  color: string,
): Bar => ({
  left,
  top,
  width: Math.max(2, Math.round(width)),
  height: Math.max(2, Math.round(height)),
  color,
});

/** One bar per element the real slide draws: a heading, a rule, an item, the chart's card. */
const bars = (slide: PlannedSlide, width: number, height: number): readonly Bar[] => {
  const area = safeArea(width, height);
  const column = area.textWidth;
  const left = area.textLeft;
  switch (slide.cue.kind) {
    case 'title': {
      const box = titleLayout(area, slide.cue.text);
      return [
        blockBar(left, box.eyebrow, column * 0.34, ACCENT),
        blockBar(left, box.title, column, INK),
        plainBar(left, box.rule, width * 0.1, Math.max(2, px(height * 0.005)), ACCENT),
        blockBar(left, box.tagline, column * 0.62, MUTED),
      ];
    }
    case 'bullets': {
      const cue = slide.cue;
      const box = bulletsLayout(area, cue, '00');
      return [
        blockBar(left, box.eyebrow, column * 0.05, MUTED),
        blockBar(left, box.title, column * 0.82, INK),
        plainBar(left, box.rule, width * 0.085, Math.max(2, px(height * 0.0042)), ACCENT),
        // The item's own length sets its width: the cue's data still drives the frame.
        ...box.items.map((item, index) =>
          blockBar(
            left,
            item,
            Math.min(column, (cue.items[index] ?? '').length * height * 0.03),
            MUTED,
          ),
        ),
        ...(box.trailing === null
          ? []
          : [plainBar(left, box.trailing, column, Math.max(1, px(height * 0.0016)), RULE)]),
      ];
    }
    case 'chart': {
      const box = chartLayout(area, slide.cue.caption);
      return [
        plainBar(left, box.rule, column * 0.2, Math.max(2, px(height * 0.004)), ACCENT),
        blockBar(left, box.caption, column * 0.7, MUTED),
        plainBar(box.card.left, box.card.top, box.card.width, box.card.height, MUTED),
      ];
    }
    case 'disclaimer': {
      const box = disclaimerLayout(area, slide.cue.text);
      return [
        blockBar(left, box.eyebrow, column * 0.2, ACCENT),
        blockBar(left, box.text, column, INK),
        ...box.credits.map((credit) => blockBar(left, credit, column * 0.9, MUTED)),
      ];
    }
    default:
      return [];
  }
};

/**
 * A slide as flat surfaces: an opaque ground, then the cue's blocks. Full-bleed on purpose, so the
 * crossfade's stand-in can paint the incoming slide over the outgoing one without any blending.
 */
export const FlatSlide = ({ slide }: { readonly slide: PlannedSlide }) => {
  const { width, height } = useTimeline();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <FlatRect left={0} top={0} width={width} height={height} color={GROUND} />
      {bars(slide, width, height).map((item, index) => (
        <FlatRect key={`${slide.cue.kind}-${String(index)}`} {...item} />
      ))}
    </div>
  );
};
