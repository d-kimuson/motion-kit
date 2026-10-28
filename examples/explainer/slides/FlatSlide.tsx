// The probe's slide stand-in: the cue's own shape, drawn as opaque rectangles on whole pixels.
//
// It replaces the scene under `flat` (`ExplainerScene`) and keeps what the gate is here to watch —
// the cue still selects the geometry, so a checklist with `n` points and a disclaimer with its credit
// rows still differ frame to frame, and the `TransitionSeries` still places each of them. What it
// drops is everything a platform rasterises its own way: the glyphs, the fractional opacity of an
// arrival, the rounded corner, the SVG a chart composes. Nothing here reads time, so a probe has no
// partial-arrival state and nothing can fade between two frames.
//
// Every block sits inside the `STAGE` region the real scenes draw in, so the probe's blocks keep
// clear of the subtitle band and the character lanes exactly as the real frame does.
import { DesignRect } from '../flat.tsx';
import { CREDITS, HEADING_HEIGHT, SCENE_BODY, STAGE, STAGE_PADDING, palette } from '../look.ts';
import { type PlannedSlide } from '../plan.ts';
import { type SlideCue } from '../script.schema.ts';

type Bar = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
};

/** The width a run of `length` characters takes at `size`, capped to the scene body. */
const textWidth = (length: number, size: number): number =>
  Math.min(SCENE_BODY.width, length * size);

/** The rows a scene's body stacks: one per point, card or warning its cue carries. */
const bodyRows = (cue: SlideCue): readonly string[] => {
  switch (cue.kind) {
    case 'title':
      return cue.agenda;
    case 'index':
      return [cue.indexLabel, cue.takeaway];
    case 'spread':
      return [cue.concentrated, cue.diversified];
    case 'chart':
      return [cue.caption];
    case 'cost':
      return [cue.note];
    case 'instalment':
      return [...cue.pillars, cue.takeaway];
    case 'risk':
      return cue.warnings;
    case 'scope':
      return [cue.near.label, cue.far.label, cue.question];
    case 'summary':
      return [...cue.items, cue.closing];
    case 'disclaimer':
      return [cue.text, ...CREDITS];
    default:
      return cue satisfies never;
  }
};

const headingOf = (cue: SlideCue): string =>
  cue.kind === 'disclaimer' ? '' : cue.kind === 'title' ? cue.text : cue.title;

/** One bar per element the real scene leads with: the heading, then a row per body item. */
const bars = (cue: SlideCue): readonly Bar[] => {
  const left = STAGE.left + SCENE_BODY.left;
  const heading = headingOf(cue);
  const rows = bodyRows(cue);
  const rowHeight = Math.min(56, Math.floor(SCENE_BODY.height / Math.max(1, rows.length)) - 12);
  return [
    ...(heading === ''
      ? []
      : [
          { left, top: STAGE.top + STAGE_PADDING, width: 64, height: 64, color: palette.gold },
          {
            left: left + 86,
            top: STAGE.top + STAGE_PADDING + 8,
            width: textWidth(heading.length, 50) - 86,
            height: 48,
            color: palette.text,
          },
          {
            left,
            top: STAGE.top + STAGE_PADDING + HEADING_HEIGHT - 16,
            width: SCENE_BODY.width / 3,
            height: 4,
            color: palette.gold,
          },
        ]),
    ...rows.map((row, index) => ({
      left,
      top: STAGE.top + SCENE_BODY.top + index * (rowHeight + 12),
      width: textWidth(row.length, 30),
      height: rowHeight,
      color: index === 0 ? palette.mint : palette.muted,
    })),
  ];
};

/**
 * A slide as flat surfaces: the stage panel, then the cue's blocks. The panel is opaque and covers
 * the whole stage, so the crossfade's stand-in can paint the incoming slide over the outgoing one
 * without any blending.
 */
export const FlatSlide = ({ slide }: { readonly slide: PlannedSlide }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <DesignRect {...STAGE} color={palette.panel} />
    {bars(slide.cue).map((item, index) => (
      <DesignRect key={`${slide.cue.kind}-${String(index)}`} {...item} />
    ))}
  </div>
);
