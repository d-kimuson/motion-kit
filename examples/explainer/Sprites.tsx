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
  characterColor,
  characterDimColor,
  framesToTime,
  mouthAt,
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
    source: spriteSource(assets, character, expression, mouth),
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

//** One character in its slot: the fetched image, or the probe's rectangle. */
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
