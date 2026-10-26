// The opening slide: the video's title, one accent rule, and the two voices introduced by name.
import { useTimeline } from '@kimuson/motion-kit';

import { ACCENT, INK, MUTED, px } from '../look.ts';
import { textColumn, useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

export const TitleSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'title') return null;
  const column = textColumn(width);
  const ruleWidth = px(width * 0.1);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.16),
          fontSize: px(height * 0.024),
          letterSpacing: '0.24em',
          color: ACCENT,
          opacity: reveal(0),
        }}
      >
        INDEX INVESTING
      </div>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.235),
          fontSize: px(height * 0.098),
          fontWeight: 700,
          lineHeight: 1.18,
          color: INK,
          opacity: reveal(0.08),
        }}
      >
        {slide.cue.text}
      </div>
      <div
        style={{
          position: 'absolute',
          left: column.left,
          top: px(height * 0.48),
          width: px(ruleWidth * reveal(0.3)),
          height: Math.max(2, px(height * 0.005)),
          background: ACCENT,
        }}
      />
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.525),
          fontSize: px(height * 0.032),
          lineHeight: 1.6,
          color: MUTED,
          opacity: reveal(0.42),
        }}
      >
        {'ずんだもんと四国めたんが、やさしく整理します。'}
      </div>
    </div>
  );
};
