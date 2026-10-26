import { BulletsSlide } from './BulletsSlide.tsx';
import { ChartSlide } from './ChartSlide.tsx';
import { DisclaimerSlide } from './DisclaimerSlide.tsx';
// Which slide a cue selects. The cue is the slide (`groupSlides` merges consecutive lines that carry
// the same one), so this is the whole dispatch.
import { type SlideProps } from './shared.ts';
import { TitleSlide } from './TitleSlide.tsx';

export const Slide = ({ slide, time }: SlideProps) => {
  switch (slide.cue.kind) {
    case 'title':
      return <TitleSlide slide={slide} time={time} />;
    case 'bullets':
      return <BulletsSlide slide={slide} time={time} />;
    case 'chart':
      return <ChartSlide slide={slide} time={time} />;
    case 'disclaimer':
      return <DisclaimerSlide slide={slide} time={time} />;
    default:
      return null;
  }
};
