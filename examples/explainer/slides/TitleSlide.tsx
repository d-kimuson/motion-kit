// The opening slide: the video's title, one accent rule, and the two voices introduced by name.
//
// Every row comes from `titleLayout`, which stacks the slide inside the shared body box
// (`look.ts`'s `safeArea`): the tagline ends above `bodyBottom`, so the subtitle plate below it never
// covers a word.
import { useTimeline } from '@kimuson/motion-kit';

import { TAGLINE, titleLayout } from '../layout.ts';
import { ACCENT, INK, MUTED, px, safeArea } from '../look.ts';
import { useSlideReveal, useSlideTime, type SlideProps } from './shared.ts';

export const TitleSlide = ({ slide, time: given }: SlideProps) => {
  const time = useSlideTime(given);
  const reveal = useSlideReveal(time);
  const { width, height } = useTimeline();
  if (slide.cue.kind !== 'title') return null;
  const area = safeArea(width, height);
  const box = titleLayout(area, slide.cue.text);
  const ruleWidth = px(width * 0.1);
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
          left: area.textLeft,
          top: box.title.top,
          width: area.textWidth,
          fontSize: box.title.size,
          fontWeight: 700,
          lineHeight: box.title.lineHeight,
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
          top: box.rule,
          width: Math.max(1, px(ruleWidth * reveal(0.3))),
          height: Math.max(2, px(height * 0.005)),
          background: ACCENT,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: area.textLeft,
          top: box.tagline.top,
          width: area.textWidth,
          fontSize: box.tagline.size,
          lineHeight: box.tagline.lineHeight,
          color: MUTED,
          opacity: reveal(0.42),
        }}
      >
        {TAGLINE}
      </div>
    </div>
  );
};
