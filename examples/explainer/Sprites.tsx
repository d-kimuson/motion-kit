// The sprite layer: both characters, the speaker lit and the other one dimmed, the speaker's
// expression and a rest/open-mouth alternation every 0.15 s.
//
// One `Sequence` per line, so the pair swaps expression exactly when the speaker changes and nothing
// moves while nobody is speaking. Each character stands in the side lane `look.ts`'s `safeArea`
// leaves clear of the text column, with its feet tucked a little behind the subtitle plate.
//
// Two ways to draw one character:
//
//   assets: 'final'        the fetched 立ち絵, a `useAsset` image inside a local `Suspense` — the
//                          shape `src/render/determinism/fixtures/references.tsx` calls
//                          `asset-suspense` — so a missing file is `asset.load-failed` at readiness,
//                          never a silently blank frame.
//   assets: 'placeholder'  a drawn character: a head with eyes and a mouth that follows the same
//                          0.15 s rhythm, a torso, and a name plate. No generated image is involved,
//                          so a fresh clone draws a deliberate figure instead of a colour fill
//                          (design doc, "Assets and provenance", amended 2026-10-27).
//
// The probe's flat branch (`useFlat`) is neither: an opaque rectangle with square corners and no
// glyph, for the reasons `flat.tsx` gives.
import { Sequence, useAsset, useTimeline, useTime } from '@kimuson/motion-kit';
import { Suspense } from 'react';

import {
  CHARACTERS,
  INK,
  PANEL,
  RULE,
  characterColor,
  characterDimColor,
  characterName,
  framesToTime,
  mouthAt,
  px,
  safeArea,
  spriteSource,
  type AssetsMode,
  type Character,
  type Expression,
  type Mouth,
} from './look.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';
import { useFlat } from './slides/shared.ts';

/** The non-speaker is dimmed to 60%: the design doc's speaker highlight. */
const dimOpacity = 0.6;

type SpriteProps = {
  readonly character: Character;
  readonly expression: Expression;
  readonly mouth: Mouth;
  readonly assets: AssetsMode;
  readonly dim: boolean;
  readonly width: number;
  readonly height: number;
};

/** One loaded sprite frame; its `Suspense` boundary sits in `SpriteSlot`. */
const SpriteFrame = ({ character, expression, mouth, assets, dim }: SpriteProps) => {
  const image = useAsset({
    kind: 'image',
    id: `sprite-${assets}-${character}-${expression}-${mouth}`,
    source: spriteSource(character, expression, mouth),
  });
  return (
    <img
      alt=""
      src={image.src}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        opacity: dim ? dimOpacity : 1,
      }}
    />
  );
};

/**
 * The eye shapes, per expression, as a fraction of the head's width: `wink` closes one eye and
 * `surprised` opens both, which is the only place the expression reaches the placeholder's picture —
 * the fetched set draws its own faces.
 */
const eyeShape: Record<
  Expression,
  { readonly width: number; readonly height: number; readonly shut: boolean }
> = {
  normal: { width: 0.16, height: 0.2, shut: false },
  happy: { width: 0.18, height: 0.09, shut: false },
  surprised: { width: 0.19, height: 0.27, shut: false },
  thinking: { width: 0.16, height: 0.14, shut: false },
  wink: { width: 0.16, height: 0.16, shut: true },
  serious: { width: 0.16, height: 0.08, shut: false },
};

/** A face colour, warm enough to read as a face on the accent panel behind it. */
const FACE = '#fdf2e4';
const MOUTH_OPEN = '#b4484d';

/**
 * The placeholder character: a head in the character's colour, a cream face on it, two eyes, a mouth
 * on the 0.15 s rhythm and a name plate across the chest.
 *
 * `expression` moves the eyes and `mouth` the mouth, so the placeholder carries the same two axes the
 * fetched sprites do. Every length is a fraction of the character's slot, and `px` rounds it: the
 * figure is drawn by the compositor, not compared byte for byte.
 */
const PlaceholderCharacter = ({
  character,
  expression,
  mouth,
  dim,
  width: slot,
  height,
}: SpriteProps) => {
  const color = characterColor[character];
  const head = px(slot * 0.64);
  const headLeft = px((slot - head) / 2);
  const headTop = px(height * 0.05);
  const faceTop = px(headTop + head * 0.3);
  const eye = eyeShape[expression];
  const eyeWidth = Math.max(2, px(head * eye.width));
  const eyeHeight = Math.max(2, px(head * eye.height));
  const faceHeight = px(head * 0.62);
  const eyeTop = px(faceTop + faceHeight * 0.24);
  const eyeGap = px(head * 0.2);
  const eyeLeft = px(slot / 2 - eyeGap / 2 - eyeWidth);
  const eyeRight = px(slot / 2 + eyeGap / 2);
  const mouthTop = px(faceTop + faceHeight * 0.62);
  const torsoWidth = px(slot * 0.66);
  const plateSize = Math.max(10, px(height * 0.026));
  const plateTop = px(headTop + head + height * 0.018);
  const eyeStyle = {
    position: 'absolute' as const,
    top: eyeTop,
    width: eyeWidth,
    height: eye.shut ? Math.max(2, px(eyeHeight / 3)) : eyeHeight,
    borderRadius: px(eyeWidth / 2),
    background: INK,
  };
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        opacity: dim ? dimOpacity : 1,
      }}
    >
      {/* The body: a bell that flares from the shoulders to the slot's foot, which the plate covers. */}
      <div
        style={{
          position: 'absolute',
          left: px((slot - torsoWidth) / 2),
          top: px(headTop + head * 0.84),
          width: torsoWidth,
          // Only the room left between the shoulders and the slot's foot, so the bell stops where the
          // plate starts instead of running past the slot and showing through the plate.
          height: px(height - (headTop + head * 0.84)),
          clipPath: 'polygon(0% 0%, 100% 0%, 82% 100%, 18% 100%)',
          background: color,
        }}
      />
      {/* Neck and shoulders, so the head sits on the body instead of in it. */}
      <div
        style={{
          position: 'absolute',
          left: px(slot / 2 - slot * 0.07),
          top: px(headTop + head * 0.8),
          width: px(slot * 0.14),
          height: px(head * 0.14),
          background: FACE,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: px((slot - torsoWidth) / 2),
          top: px(headTop + head * 0.9),
          width: torsoWidth,
          height: px(torsoWidth * 0.3),
          borderTopLeftRadius: px(torsoWidth),
          borderTopRightRadius: px(torsoWidth),
          background: color,
        }}
      />
      {/* The head: the character's colour as hair, with a cream face laid over its lower two thirds. */}
      <div
        style={{
          position: 'absolute',
          left: headLeft,
          top: headTop,
          width: head,
          height: head,
          borderRadius: '50%',
          background: color,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: px(headLeft + head * 0.06),
          top: faceTop,
          width: px(head * 0.88),
          height: faceHeight,
          borderBottomLeftRadius: px(head * 0.44),
          borderBottomRightRadius: px(head * 0.44),
          background: FACE,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: px(headLeft + head * 0.12),
          top: px(faceTop - head * 0.05),
          width: px(head * 0.76),
          height: px(head * 0.16),
          borderBottomLeftRadius: px(head * 0.2),
          borderBottomRightRadius: px(head * 0.2),
          background: color,
        }}
      />
      <div style={{ ...eyeStyle, left: eyeLeft }} />
      {expression === 'wink' ? null : <div style={{ ...eyeStyle, left: eyeRight }} />}
      {mouth === 'open' ? (
        <div
          style={{
            position: 'absolute',
            left: px(slot / 2 - head * 0.11),
            top: mouthTop,
            width: px(head * 0.22),
            height: px(head * 0.15),
            borderRadius: '50%',
            background: MOUTH_OPEN,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            left: px(slot / 2 - head * 0.1),
            top: mouthTop,
            width: px(head * 0.2),
            height: Math.max(2, px(head * 0.035)),
            borderRadius: px(head * 0.02),
            background: MOUTH_OPEN,
          }}
        />
      )}
      {/* The name plate: who is on screen, for a viewer who reads the character before the band. */}
      <div
        style={{
          position: 'absolute',
          left: px((slot - plateSize * (characterName[character].length * 1.1 + 1.4)) / 2),
          top: plateTop,
          padding: `${px(plateSize * 0.18)}px ${px(plateSize * 0.7)}px`,
          boxSizing: 'border-box',
          borderRadius: px(plateSize),
          border: `${Math.max(1, px(plateSize * 0.09))}px solid ${RULE}`,
          background: PANEL,
          fontSize: plateSize,
          lineHeight: 1.1,
          color: INK,
          whiteSpace: 'nowrap',
        }}
      >
        {characterName[character]}
      </div>
    </div>
  );
};

/** One character in its slot: the placeholder figure, the fetched image, or the probe's rectangle. */
const SpriteSlot = (props: SpriteProps) => {
  const flat = useFlat();
  if (flat)
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: props.dim
            ? characterDimColor[props.character]
            : characterColor[props.character],
        }}
      />
    );
  if (props.assets === 'placeholder')
    return (
      <PlaceholderCharacter
        character={props.character}
        expression={props.expression}
        mouth={props.mouth}
        assets={props.assets}
        dim={props.dim}
        width={props.width}
        height={props.height}
      />
    );
  return (
    <Suspense fallback={null}>
      <SpriteFrame
        character={props.character}
        expression={props.expression}
        mouth={props.mouth}
        assets={props.assets}
        dim={props.dim}
        width={props.width}
        height={props.height}
      />
    </Suspense>
  );
};

type LineSpritesProps = {
  readonly line: PlannedLine;
  readonly assets: AssetsMode;
};

/** The pair in view during one line: the speaker holds the line's expression and mouths, the other
 * one rests at `normal`. */
const LineSprites = ({ line, assets }: LineSpritesProps) => {
  const time = useTime();
  const { width, height } = useTimeline();
  const area = safeArea(width, height);
  const slot = {
    position: 'absolute' as const,
    width: area.spriteWidth,
    height: area.spriteHeight,
    top: area.spriteTop,
  };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {CHARACTERS.map((character) => {
        const speaking = character === line.speaker;
        return (
          <div
            key={character}
            style={{
              ...slot,
              ...(character === 'zundamon'
                ? { left: area.spriteLeft }
                : { left: area.spriteRight }),
            }}
          >
            <SpriteSlot
              character={character}
              expression={speaking ? line.expression : 'normal'}
              mouth={speaking ? mouthAt(time) : 'rest'}
              assets={assets}
              dim={!speaking}
              width={area.spriteWidth}
              height={area.spriteHeight}
            />
          </div>
        );
      })}
    </div>
  );
};

export type SpritesProps = {
  readonly storyboard: Storyboard;
  readonly assets: AssetsMode;
};

/**
 * One `Sequence` per line, each carrying both characters. The name plate on a placeholder and the
 * subtitle band both name the speaker, which is what makes the video followable with the sound off.
 */
export const Sprites = ({ storyboard, assets }: SpritesProps) => (
  <>
    {storyboard.lines.map((line) => (
      <Sequence
        key={`sprites-${line.id}`}
        from={framesToTime(line.startFrame, storyboard.fps)}
        duration={framesToTime(line.frames, storyboard.fps)}
      >
        <LineSprites line={line} assets={assets} />
      </Sequence>
    ))}
  </>
);
