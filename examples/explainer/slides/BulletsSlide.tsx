// A bullet slide: the cue's title, an accent rule, and one line per item arriving under the
// narration that reaches it. Each item is opacity only.
//
// The rows come from `bulletsLayout`: the stack starts at the body's top and every item's height is
// its own line count, so the third item — and the rule that closes the list, when there is room —
// end above `bodyBottom`, clear of the subtitle plate and left of the character lanes.
import { useTimeline } from '@kimuson/motion-kit';

import { bulletsLayout } from '../layout.ts';
import { ACCENT, INK, MUTED, RULE, safeArea } from '../look.ts';
import { useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

/** One item every 0.55 s: the narration reaches the second and third over the first few seconds. */
const itemDelaySeconds = 0.55;

export const BulletsSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'bullets') return null;
  const area = safeArea(width, height);
  const box = bulletsLayout(area, slide.cue, String(slide.index + 1).padStart(2, '0'));
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.title.top,
          width: area.textWidth,
          fontSize: box.title.size,
          fontWeight: 700,
          lineHeight: box.title.lineHeight,
          color: INK,
          opacity: reveal(0),
        }}
      >
        {slide.cue.title}
      </div>
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.rule,
          width: Math.max(1, Math.round(area.width * 0.085 * reveal(0.2))),
          height: Math.max(2, Math.round(height * 0.0042)),
          background: ACCENT,
        }}
      />
      {slide.cue.items.map((item, index) => {
        const row = box.items[index];
        if (row === undefined) return null;
        return (
          <div
            key={item}
            style={{
              position: 'absolute',
              left: area.textLeft,
              top: row.top,
              width: area.textWidth,
              height: row.height,
              display: 'flex',
              alignItems: 'center',
              gap: box.bulletGap,
              opacity: reveal(0.32 + index * itemDelaySeconds),
            }}
          >
            <div
              style={{
                width: box.bullet,
                height: box.bullet,
                flex: '0 0 auto',
                background: ACCENT,
              }}
            />
            <div
              style={{
                width: box.itemWidth,
                fontSize: row.size,
                lineHeight: row.lineHeight,
                color: INK,
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
      {box.trailing === null ? null : (
        <div
          style={{
            position: 'absolute',
            left: area.textLeft,
            top: box.trailing,
            width: area.textWidth,
            height: Math.max(1, Math.round(height * 0.0016)),
            background: RULE,
            opacity: reveal(0.5),
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.eyebrow.top,
          fontSize: box.eyebrow.size,
          lineHeight: box.eyebrow.lineHeight,
          letterSpacing: '0.2em',
          color: MUTED,
          opacity: reveal(0),
        }}
      >
        {String(slide.index + 1).padStart(2, '0')}
      </div>
    </div>
  );
};
