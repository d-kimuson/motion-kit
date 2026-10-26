// The chart slide: the `chart` example's own SVG component, from its own committed dataset.
//
// Nothing is copied and no library is added — `ChartScene` and `examples/chart/data/index-30y.json`
// are the two things the design doc says this slide reuses. The overrides exist because a slide is
// 22 seconds of a 222-second Composition: the chart times its draw-on and count-up to the slide.
import { useTimeline } from '@kimuson/motion-kit';

import { ChartScene } from '../../chart/chart.tsx';
import index30y from '../../chart/data/index-30y.json';
import { chartProps } from '../../chart/entry.tsx';
import { type ChartProps } from '../../chart/scale.ts';
import { ACCENT, GROUND, MUTED, px } from '../look.ts';
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
  const captionWidth = px(width * 0.34);
  return (
    <div style={{ position: 'absolute', inset: 0, background: GROUND }}>
      {dataset === undefined ? (
        <div
          style={{
            position: 'absolute',
            left: px(width * 0.075),
            top: px(height * 0.4),
            fontSize: px(height * 0.032),
            color: MUTED,
          }}
        >
          {`unknown chart dataset: ${slide.cue.chartId}`}
        </div>
      ) : (
        <ChartScene {...dataset} frame={localFrame} durationInFrames={slide.contentFrames} />
      )}
      <div
        style={{
          position: 'absolute',
          left: px(width * 0.955) - captionWidth,
          top: px(height * 0.1),
          width: captionWidth,
          display: 'flex',
          justifyContent: 'flex-end',
          borderTop: `${Math.max(2, px(height * 0.004))}px solid ${ACCENT}`,
          paddingTop: px(height * 0.014),
          opacity: reveal(0.6),
        }}
      >
        <div
          style={{
            fontSize: px(height * 0.028),
            lineHeight: 1.5,
            color: MUTED,
            textAlign: 'right',
          }}
        >
          {slide.cue.caption}
        </div>
      </div>
    </div>
  );
};
