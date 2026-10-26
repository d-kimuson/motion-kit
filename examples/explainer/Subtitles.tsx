// The subtitle layer: one `Sequence` per line, at the line's frame-derived start, with no
// transitions anywhere. It is the layer that proves many `Sequence`s in one Composition keep exact
// timing, so a line appears on the first frame of its own line and never a frame early.
//
// The band carries the speaker's name, so the video reads with the sound off: the name is the only
// thing that says who is talking when only one sprite is mouthing.
import { Sequence, useTimeline } from '@kimuson/motion-kit';

import { FlatRect } from './flat.tsx';
import {
  ACCENT,
  INK,
  PANEL,
  characterColor,
  characterName,
  framesToTime,
  px,
  type AssetsMode,
} from './look.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';
import { useFlat } from './slides/shared.ts';

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

/**
 * The band under `flat`: the same rectangle in the same place, opaque, square-cornered and without a
 * glyph. The real band is 96 % opaque, has a rounded border and carries two lines of text — a blend,
 * an antialiased edge and a glyph run at a fractional alpha — which is the combination a probe cannot
 * compare byte for byte across platforms. The speaker still drives the frame: their name becomes a
 * solid block in their colour.
 */
const FlatSubtitleBand = ({ line }: { readonly line: PlannedLine }) => {
  const { width, height } = useTimeline();
  const bandHeight = px(height * 0.19);
  const speaker = px(height * 0.055);
  return (
    <div
      style={{
        position: 'absolute',
        left: px(width * 0.045),
        width: px(width * 0.91),
        bottom: px(height * 0.028),
        height: bandHeight,
        background: PANEL,
      }}
    >
      <FlatRect
        left={px(width * 0.022)}
        top={px((bandHeight - speaker) / 2)}
        width={speaker}
        height={speaker}
        color={characterColor[line.speaker]}
      />
    </div>
  );
};

export type SubtitlesProps = {
  readonly storyboard: Storyboard;
  /** Present so both visual layers take the same props; the band is DOM text either way. */
  readonly assets: AssetsMode;
};

export const Subtitles = ({ storyboard }: SubtitlesProps) => {
  const flat = useFlat();
  return (
    <>
      {storyboard.lines.map((line) => (
        <Sequence
          key={`subtitle-${line.id}`}
          from={framesToTime(line.startFrame, storyboard.fps)}
          duration={framesToTime(line.frames, storyboard.fps)}
        >
          {flat ? <FlatSubtitleBand line={line} /> : <SubtitleLine line={line} />}
        </Sequence>
      ))}
    </>
  );
};
