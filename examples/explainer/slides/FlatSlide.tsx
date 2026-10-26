// The probe's slide stand-in: the cue's own shape, drawn as opaque rectangles on whole pixels.
//
// It replaces `Slide` under `flat` (`ExplainerScene`) and keeps what the gate is here to watch — the
// cue still selects the geometry, so a title, a bullets slide with `n` items, a chart block and a
// disclaimer still differ frame to frame, and the `TransitionSeries` still places each of them. What
// it drops is everything a platform rasterises their own way: the glyphs, the fractional opacity of
// the entrance, the border radius and the SVG the chart slide composes. `progress` is not read: a
// probe has no partial-arrival state, so nothing here can fade between two frames.
import { useTimeline } from '@kimuson/motion-kit';

import { FlatRect } from '../flat.tsx';
import { ACCENT, GROUND, INK, MUTED, RULE, px } from '../look.ts';
import { type PlannedSlide } from '../plan.ts';

type Bar = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
};

/** One block per element the real slide draws: a heading, a rule, an item, the chart's panel. */
const bars = (slide: PlannedSlide, width: number, height: number): readonly Bar[] => {
  const left = px(width * 0.075);
  const column = px(width * 0.72);
  const heading = Math.max(2, px(height * 0.055));
  const line = Math.max(2, px(height * 0.032));
  switch (slide.cue.kind) {
    case 'title':
      return [
        {
          left,
          top: px(height * 0.16),
          width: px(column * 0.34),
          height: Math.max(2, px(height * 0.022)),
          color: ACCENT,
        },
        { left, top: px(height * 0.235), width: column, height: px(height * 0.098), color: INK },
        {
          left,
          top: px(height * 0.48),
          width: px(width * 0.1),
          height: Math.max(2, px(height * 0.005)),
          color: ACCENT,
        },
        { left, top: px(height * 0.525), width: px(column * 0.62), height: line, color: MUTED },
      ];
    case 'bullets': {
      const firstTop = px(height * 0.315);
      const gap = px(height * 0.098);
      const items = slide.cue.items.map((item, index) => ({
        left,
        top: firstTop + index * gap,
        // The item's own length sets its width: the cue's data still drives the frame.
        width: Math.min(column, Math.max(2, px(item.length * height * 0.03))),
        height: Math.max(2, px(height * 0.044)),
        color: MUTED,
      }));
      return [
        { left, top: px(height * 0.115), width: px(column * 0.82), height: heading, color: INK },
        {
          left,
          top: px(height * 0.225),
          width: px(width * 0.085),
          height: Math.max(2, px(height * 0.0042)),
          color: ACCENT,
        },
        ...items,
        {
          left,
          top: firstTop + slide.cue.items.length * gap + px(height * 0.02),
          width: column,
          height: Math.max(1, px(height * 0.0016)),
          color: RULE,
        },
      ];
    }
    case 'chart':
      return [
        {
          left: px(width * 0.075),
          top: px(height * 0.15),
          width: px(width * 0.6),
          height: px(height * 0.55),
          color: MUTED,
        },
        {
          left: px(width * 0.7),
          top: px(height * 0.1),
          width: px(width * 0.255),
          height: line,
          color: ACCENT,
        },
        {
          left: px(width * 0.7),
          top: px(height * 0.1) + line * 2,
          width: px(width * 0.18),
          height: Math.max(2, px(height * 0.02)),
          color: MUTED,
        },
      ];
    case 'disclaimer':
      return [
        {
          left,
          top: px(height * 0.085),
          width: px(column * 0.2),
          height: Math.max(2, px(height * 0.022)),
          color: ACCENT,
        },
        { left, top: px(height * 0.15), width: column, height: heading, color: INK },
        {
          left,
          top: px(height * 0.44),
          width: px(column * 0.9),
          height: Math.max(2, px(height * 0.0215)),
          color: MUTED,
        },
        {
          left,
          top: px(height * 0.44) + Math.max(2, px(height * 0.0215)) * 3,
          width: px(column * 0.7),
          height: Math.max(2, px(height * 0.0215)),
          color: MUTED,
        },
      ];
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
      {bars(slide, width, height).map((bar, index) => (
        <FlatRect key={`${slide.cue.kind}-${String(index)}`} {...bar} />
      ))}
    </div>
  );
};
