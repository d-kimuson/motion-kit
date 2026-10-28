// The top bar: the video's title on the left, and on the right where the viewer is — the chapter's
// number and name, and one segment per chapter that fills as the chapter plays. It reads the frame
// rather than living in a `Sequence`, because it spans the whole video and changes on slide edges.
import { useFrame } from '@kimuson/motion-kit';

import { DesignRect } from './flat.tsx';
import { TOP_BAR, palette } from './look.ts';
import { slideAt, type PlannedSlide, type Storyboard } from './plan.ts';
import { useFlat } from './slides/shared.ts';

const SEGMENT_WIDTH = 46;
const SEGMENT_GAP = 8;

/** The slides that are chapters: everything between the title and the disclaimer. */
const chaptersOf = (storyboard: Storyboard): readonly PlannedSlide[] =>
  storyboard.slides.filter(
    (slide) => slide.cue.kind !== 'title' && slide.cue.kind !== 'disclaimer',
  );

const chapterTitle = (slide: PlannedSlide | undefined): string =>
  slide === undefined || slide.cue.kind === 'title' || slide.cue.kind === 'disclaimer'
    ? ''
    : slide.cue.title;

export const Chrome = ({
  storyboard,
  title,
}: {
  readonly storyboard: Storyboard;
  readonly title: string;
}) => {
  const frame = useFrame();
  const flat = useFlat();
  const chapters = chaptersOf(storyboard);
  const current = slideAt(storyboard, frame);
  const fill = (slide: PlannedSlide): number =>
    frame >= slide.startFrame + slide.frames
      ? 1
      : frame < slide.startFrame
        ? 0
        : (frame - slide.startFrame) / slide.frames;
  const segmentsLeft =
    TOP_BAR.left + TOP_BAR.width - chapters.length * (SEGMENT_WIDTH + SEGMENT_GAP) + SEGMENT_GAP;
  if (flat)
    return (
      <>
        {chapters.map((slide, index) => (
          <DesignRect
            key={`segment-${String(slide.index)}`}
            left={segmentsLeft + index * (SEGMENT_WIDTH + SEGMENT_GAP)}
            top={TOP_BAR.top + 24}
            width={SEGMENT_WIDTH}
            height={8}
            color={fill(slide) >= 1 ? palette.gold : palette.faint}
          />
        ))}
      </>
    );
  const label = chapterTitle(current);
  return (
    <div
      style={{
        position: 'absolute',
        left: TOP_BAR.left,
        top: TOP_BAR.top,
        width: TOP_BAR.width,
        height: TOP_BAR.height,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 22px 8px 14px',
          borderRadius: 999,
          background: 'rgba(17, 30, 53, 0.85)',
          border: `2px solid ${palette.panelEdge}`,
          fontSize: 24,
          fontWeight: 900,
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: 7, background: palette.gold }} />
        {title}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
        {label === '' || current === undefined ? null : (
          <div style={{ fontSize: 22, fontWeight: 700, color: palette.muted }}>
            <span style={{ color: palette.gold, fontWeight: 900, marginRight: 10 }}>
              {String(current.index).padStart(2, '0')}
            </span>
            {label}
          </div>
        )}
        <div style={{ display: 'flex', gap: SEGMENT_GAP }}>
          {chapters.map((slide) => (
            <div
              key={`segment-${String(slide.index)}`}
              style={{
                width: SEGMENT_WIDTH,
                height: 8,
                borderRadius: 4,
                background: palette.faint,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${String(fill(slide) * 100)}%`,
                  height: '100%',
                  background: palette.gold,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
