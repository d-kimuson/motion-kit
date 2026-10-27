// The subtitle layer: one `Sequence` per line, at the line's frame-derived start, with no
// transitions anywhere. It is the layer that proves many `Sequence`s in one Composition keep exact
// timing, so a line appears on the first frame of its own line and never a frame early.
//
// The band carries the speaker's name, so the video reads with the sound off: the name is the only
// thing that says who is talking when only one sprite is mouthing.
//
// Its geometry is the shared one (`look.ts`'s `safeArea`): the plate fills the band box between
// `BAND_TOP` and the frame's bottom margin, and no slide paints between the body and it. The plate is
// a fixed height — a name line and `BODY_LINES` body lines at 72 px — and a line too long for three
// lines at that size is drawn smaller until it fits (`layout.ts`'s `bodyFontSize`), so the band never
// grows over the slide and never clips a line.
import { Sequence, useTimeline } from '@kimuson/motion-kit';

import { FlatRect } from './flat.tsx';
import { bodyFontSize } from './layout.ts';
import {
  ACCENT,
  BODY_LINE_HEIGHT,
  BODY_SIZE,
  INK,
  NAME_LINE_HEIGHT,
  NAME_SIZE,
  PANEL,
  characterColor,
  characterName,
  framesToTime,
  px,
  safeArea,
  type AssetsMode,
} from './look.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';
import { useFlat } from './slides/shared.ts';

const SubtitleLine = ({ line }: { readonly line: PlannedLine }) => {
  const { width, height } = useTimeline();
  const area = safeArea(width, height);
  const bodySize = bodyFontSize(line.text, area, px(height * BODY_SIZE));
  return (
    <div
      style={{
        position: 'absolute',
        left: area.bandLeft,
        top: area.bandTop,
        width: area.bandWidth,
        height: area.bandHeight,
        padding: `${area.bandPaddingY}px ${area.bandPaddingX}px`,
        boxSizing: 'border-box',
        borderRadius: px(height * 0.012),
        border: `${Math.max(1, px(height * 0.0014))}px solid #ece4d4`,
        background: PANEL,
        opacity: 0.96,
      }}
    >
      <div
        style={{
          fontSize: px(height * NAME_SIZE),
          lineHeight: NAME_LINE_HEIGHT,
          letterSpacing: '0.06em',
          color: ACCENT,
        }}
      >
        {characterName[line.speaker]}
      </div>
      <div
        style={{
          fontSize: bodySize,
          fontWeight: 400,
          lineHeight: BODY_LINE_HEIGHT,
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
  const area = safeArea(width, height);
  const speaker = px(height * 0.055);
  return (
    <div
      style={{
        position: 'absolute',
        left: area.bandLeft,
        top: area.bandTop,
        width: area.bandWidth,
        height: area.bandHeight,
        background: PANEL,
      }}
    >
      <FlatRect
        left={area.bandPaddingX}
        top={Math.round((area.bandHeight - speaker) / 2)}
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
