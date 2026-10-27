// The tail slide: the disclaimer the last line speaks, and the credit block the asset licensing ADR
// requires on screen. It is held for the 3-second tail after the last line, so the credits are on
// screen while nobody is speaking.
//
// `disclaimerLayout` stacks the three groups — the notice, the disclaimer and the credits — inside the
// shared body box, so the four credit lines end above the plate instead of behind it.
import { useTimeline } from '@kimuson/motion-kit';

import { disclaimerLayout } from '../layout.ts';
import { ACCENT, CREDITS, INK, MUTED, safeArea } from '../look.ts';
import { useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

export const DisclaimerSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'disclaimer') return null;
  const area = safeArea(width, height);
  const box = disclaimerLayout(area, slide.cue.text);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.eyebrow.top,
          width: area.textWidth,
          fontSize: box.eyebrow.size,
          lineHeight: box.eyebrow.lineHeight,
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
          left: area.textLeft,
          top: box.text.top,
          width: area.textWidth,
          fontSize: box.text.size,
          lineHeight: box.text.lineHeight,
          color: INK,
          opacity: reveal(0.08),
        }}
      >
        {slide.cue.text}
      </div>
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.credits[0]?.top ?? box.text.top + box.text.height,
          width: area.textWidth,
          fontSize: box.credits[0]?.size ?? box.text.size,
          lineHeight: box.credits[0]?.lineHeight ?? 1.8,
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
