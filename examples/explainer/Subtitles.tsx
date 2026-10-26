// The subtitle layer: one `Sequence` per line, at the line's frame-derived start, with no
// transitions anywhere. It is the layer that proves many `Sequence`s in one Composition keep exact
// timing, so a line appears on the first frame of its own line and never a frame early.
//
// The band carries the speaker's name, so the video reads with the sound off: the name is the only
// thing that says who is talking when only one sprite is mouthing.
import { Sequence, useTimeline } from '@kimuson/motion-kit';

import { ACCENT, framesToTime, INK, PANEL, characterName, px, type AssetsMode } from './look.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';

const SubtitleLine = ({ line }: { readonly line: PlannedLine }) => {
  const { width, height } = useTimeline();
  return (
    <div
      style={{
        position: 'absolute',
        left: px(width * 0.045),
        width: px(width * 0.91),
        bottom: px(height * 0.028),
        padding: `${px(height * 0.02)}px ${px(width * 0.022)}px`,
        boxSizing: 'border-box',
        borderRadius: px(height * 0.012),
        border: `${Math.max(1, px(height * 0.0014))}px solid #ece4d4`,
        background: PANEL,
        opacity: 0.96,
      }}
    >
      <div
        style={{
          fontSize: px(height * 0.0255),
          lineHeight: 1.4,
          letterSpacing: '0.06em',
          color: ACCENT,
        }}
      >
        {characterName[line.speaker]}
      </div>
      <div
        style={{
          fontSize: px(height * 0.0667),
          fontWeight: 400,
          lineHeight: 1.34,
          color: INK,
        }}
      >
        {line.text}
      </div>
    </div>
  );
};

export type SubtitlesProps = {
  readonly storyboard: Storyboard;
  /** Present so both visual layers take the same props; the band is DOM text either way. */
  readonly assets: AssetsMode;
};

export const Subtitles = ({ storyboard }: SubtitlesProps) => (
  <>
    {storyboard.lines.map((line) => (
      <Sequence
        key={`subtitle-${line.id}`}
        from={framesToTime(line.startFrame, storyboard.fps)}
        duration={framesToTime(line.frames, storyboard.fps)}
      >
        <SubtitleLine line={line} />
      </Sequence>
    ))}
  </>
);
