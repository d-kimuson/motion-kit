// The chart slide: the `chart` example's own SVG component, from its own committed dataset.
//
// Nothing is copied and no library is added — `ChartScene` and `examples/chart/data/index-30y.json`
// are the two things the design doc says this slide reuses. The overrides exist because a slide is
// 22 seconds of a 222-second Composition: the chart times its draw-on and count-up to the slide.
//
// `ChartScene` fills its frame — its plot and its year labels run to 0.96 of the height — so drawing it
// as it is puts the bottom half of the plot under the subtitle plate. `chartLayout` scales the whole
// chart into the shared body box instead, with the caption stacked above it, so the axis, the year
// labels and the source line all stay clear of the plate.
import { useTimeline } from '@kimuson/motion-kit';

import { ChartScene } from '../../chart/chart.tsx';
import index30y from '../../chart/data/index-30y.json';
import { chartProps } from '../../chart/entry.tsx';
import { type ChartProps } from '../../chart/scale.ts';
import { chartLayout } from '../layout.ts';
import { ACCENT, MUTED, safeArea } from '../look.ts';
import { type SlideProps, useSlideReveal, useSlideTime } from './shared.ts';

/** Every dataset the script may name by `chartId`. A reader adds one row to add a chart. */
const datasets: Record<string, ChartProps> = {
  'index-30y': chartProps.parse(index30y),
};

export const ChartSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height, frameRate } = useTimeline();
  if (slide.cue.kind !== 'chart') return null;
  const fps = Number(frameRate.numerator) / Number(frameRate.denominator);
  const localFrame = Math.round(time * fps);
  const dataset = datasets[slide.cue.chartId];
  const area = safeArea(width, height);
  const box = chartLayout(area, slide.cue.caption);
  const { card } = box;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.rule,
          width: Math.max(1, Math.round(area.textWidth * reveal(0.6))),
          height: Math.max(2, Math.round(height * 0.004)),
          background: ACCENT,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.caption.top,
          width: area.textWidth,
          fontSize: box.caption.size,
          lineHeight: box.caption.lineHeight,
          color: MUTED,
          opacity: reveal(0.6),
        }}
      >
        {slide.cue.caption}
      </div>
      <div
        style={{
          position: 'absolute',
          left: card.left,
          top: card.top,
          width: card.width,
          height: card.height,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: card.offsetX,
            top: card.offsetY,
            width,
            height,
            transform: `scale(${String(card.scale)})`,
            transformOrigin: 'top left',
          }}
        >
          {dataset === undefined ? (
            <div
              style={{
                position: 'absolute',
                left: area.textLeft,
                top: area.bodyTop,
                fontSize: Math.round(height * 0.032),
                color: MUTED,
              }}
            >
              {`unknown chart dataset: ${slide.cue.chartId}`}
            </div>
          ) : (
            <ChartScene {...dataset} frame={localFrame} durationInFrames={slide.contentFrames} />
          )}
        </div>
      </div>
    </div>
  );
};
