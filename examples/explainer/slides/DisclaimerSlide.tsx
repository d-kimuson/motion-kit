// The tail slide: the disclaimer the last line speaks, and the credit block the asset licensing ADR
// requires on screen. It is held for the 3-second tail after the last line, so the credits are on
// screen while nobody is speaking.
import { useTimeline } from '@kimuson/motion-kit';

import { ACCENT, CREDITS, INK, MUTED, px } from '../look.ts';
import { textColumn, useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

export const DisclaimerSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'disclaimer') return null;
  const column = textColumn(width);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.085),
          fontSize: px(height * 0.028),
          letterSpacing: '0.22em',
          color: ACCENT,
          opacity: reveal(0),
        }}
      >
        ご注意
      </div>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.15),
          fontSize: px(height * 0.038),
          lineHeight: 1.7,
          color: INK,
          opacity: reveal(0.08),
        }}
      >
        {slide.cue.text}
      </div>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.44),
          fontSize: px(height * 0.0215),
          lineHeight: 1.85,
          color: MUTED,
          opacity: reveal(0.28),
        }}
      >
        {CREDITS.map((credit) => (
          <div key={credit}>{credit}</div>
        ))}
      </div>
    </div>
  );
};
