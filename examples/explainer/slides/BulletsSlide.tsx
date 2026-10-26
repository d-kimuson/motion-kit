// A bullet slide: the cue's title, an accent rule, and one line per item arriving under the
// narration that reaches it. Each item is opacity only.
import { useTimeline } from '@kimuson/motion-kit';

import { ACCENT, INK, MUTED, RULE, px } from '../look.ts';
import { textColumn, useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

/** One item every 0.55 s: the narration reaches the second and third over the first few seconds. */
const itemDelaySeconds = 0.55;

export const BulletsSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'bullets') return null;
  const column = textColumn(width);
  const itemSize = px(height * 0.044);
  const itemGap = px(height * 0.098);
  const firstTop = px(height * 0.315);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          ...column,
          top: px(height * 0.115),
          fontSize: px(height * 0.062),
          fontWeight: 700,
          lineHeight: 1.3,
          color: INK,
          opacity: reveal(0),
        }}
      >
        {slide.cue.title}
      </div>
      <div
        style={{
          position: 'absolute',
          left: column.left,
          top: px(height * 0.225),
          width: px(width * 0.085 * reveal(0.2)),
          height: Math.max(2, px(height * 0.0042)),
          background: ACCENT,
        }}
      />
      {slide.cue.items.map((item, index) => (
        <div
          key={item}
          style={{
            position: 'absolute',
            left: column.left,
            top: firstTop + index * itemGap,
            display: 'flex',
            alignItems: 'center',
            gap: px(width * 0.016),
            opacity: reveal(0.32 + index * itemDelaySeconds),
          }}
        >
          <div
            style={{
              width: px(height * 0.016),
              height: px(height * 0.016),
              background: ACCENT,
            }}
          />
          <div style={{ fontSize: itemSize, lineHeight: 1.35, color: INK }}>{item}</div>
        </div>
      ))}
      <div
        style={{
          position: 'absolute',
          ...column,
          top: firstTop + slide.cue.items.length * itemGap + px(height * 0.02),
          height: Math.max(1, px(height * 0.0016)),
          background: RULE,
          opacity: reveal(0.5),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: column.left,
          top: px(height * 0.06),
          fontSize: px(height * 0.022),
          letterSpacing: '0.2em',
          color: MUTED,
          opacity: reveal(0),
        }}
      >
        {`0${slide.index + 1}`}
      </div>
    </div>
  );
};
