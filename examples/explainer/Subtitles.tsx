// The subtitle layer: one sentence at a time, one `Sequence` per sentence at its frame-derived start,
// so a sentence appears on the first frame the voice starts it and never a frame early.
//
// The box is fixed (`SUBTITLE` in `look.ts`) and a sentence is sized and broken into lines to fit it
// (`layout.ts`), so it never grows over the stage, never clips, and never wraps mid-word. The
// speaker's name rides on the box's top edge in their colour, and the glyphs are stroked in the
// speaker's deep shade, so the video reads with the sound off. The words the line's `emphasis` names are set in gold — the same words the scene animates.
import { Sequence, useTime } from '@kimuson/motion-kit';

import { DesignRect } from './flat.tsx';
import { emphasisRuns, subtitleFit } from './layout.ts';
import {
  SUBTITLE,
  SUBTITLE_PADDING_BOTTOM,
  SUBTITLE_PADDING_TOP,
  SUBTITLE_PADDING_X,
  SUBTITLE_PLATE_OFFSET,
  characterColor,
  characterInk,
  characterName,
  framesToTime,
  palette,
} from './look.ts';
import { enter } from './motion.ts';
import { type PlannedSentence, type Storyboard } from './plan.ts';
import { codePointLength } from './script.schema.ts';
import { useFlat } from './slides/shared.ts';

const NAME_SIZE = 28;

const SubtitleSentence = ({ sentence }: { readonly sentence: PlannedSentence }) => {
  const t = useTime();
  const fit = subtitleFit(sentence.text, sentence.emphasis);
  const arrive = enter(t, 0, 0.18);
  const ink = characterInk[sentence.speaker];
  return (
    <div
      style={{
        position: 'absolute',
        left: SUBTITLE.left,
        top: SUBTITLE.top + SUBTITLE_PLATE_OFFSET,
        width: SUBTITLE.width,
        height: SUBTITLE.height - SUBTITLE_PLATE_OFFSET,
        boxSizing: 'border-box',
        padding: `${String(SUBTITLE_PADDING_TOP)}px ${String(SUBTITLE_PADDING_X)}px ${String(SUBTITLE_PADDING_BOTTOM)}px`,
        borderRadius: 26,
        background: 'linear-gradient(180deg, rgba(9, 16, 31, 0.92), rgba(9, 16, 31, 0.86))',
        border: `3px solid ${characterColor[sentence.speaker]}99`,
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 36,
          top: -24,
          padding: '4px 22px',
          borderRadius: 999,
          background: characterColor[sentence.speaker],
          color: ink,
          fontSize: NAME_SIZE,
          fontWeight: 900,
          lineHeight: 1.3,
          border: `3px solid ${palette.groundTop}`,
        }}
      >
        {characterName[sentence.speaker]}
      </div>
      <div
        lang="ja"
        style={{
          width: '100%',
          textAlign: 'center',
          fontSize: fit.size,
          lineHeight: fit.lineHeight,
          fontWeight: 900,
          letterSpacing: '0.04em',
          color: palette.text,
          WebkitTextStroke: `${String(Math.round(fit.size * 0.16))}px ${ink}`,
          paintOrder: 'stroke fill',
          whiteSpace: 'nowrap',
          opacity: arrive,
          transform: `translateY(${String(8 * (1 - arrive))}px)`,
        }}
      >
        {fit.lines.map((line, row) => (
          <div key={`${String(row)}-${line}`}>
            {emphasisRuns(line, sentence.emphasis).map((run, index) => (
              <span
                key={`${String(index)}-${run.text}`}
                style={run.emphasis ? { color: palette.gold } : undefined}
              >
                {run.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The probe's stand-in: the box, and one bar whose width is the sentence's own length. */
const FlatSentence = ({ sentence }: { readonly sentence: PlannedSentence }) => {
  const fit = subtitleFit(sentence.text, sentence.emphasis);
  const width = Math.min(
    SUBTITLE.width - 2 * SUBTITLE_PADDING_X,
    codePointLength(sentence.text) * fit.size * 0.5,
  );
  return (
    <>
      <DesignRect
        left={SUBTITLE.left}
        top={SUBTITLE.top + SUBTITLE_PLATE_OFFSET}
        width={SUBTITLE.width}
        height={SUBTITLE.height - SUBTITLE_PLATE_OFFSET}
        color={palette.panel}
      />
      <DesignRect
        left={SUBTITLE.left + 36}
        top={SUBTITLE.top}
        width={160}
        height={44}
        color={characterColor[sentence.speaker]}
      />
      <DesignRect
        left={SUBTITLE.left + (SUBTITLE.width - width) / 2}
        top={SUBTITLE.top + 100}
        width={width}
        height={fit.size}
        color={palette.text}
      />
    </>
  );
};

export const Subtitles = ({ storyboard }: { readonly storyboard: Storyboard }) => {
  const flat = useFlat();
  return (
    <>
      {storyboard.lines.flatMap((line) =>
        line.sentences.map((sentence, index) => (
          <Sequence
            key={`${line.id}-${String(index)}`}
            from={framesToTime(sentence.startFrame, storyboard.fps)}
            duration={framesToTime(sentence.frames, storyboard.fps)}
          >
            {flat ? <FlatSentence sentence={sentence} /> : <SubtitleSentence sentence={sentence} />}
          </Sequence>
        )),
      )}
    </>
  );
};
