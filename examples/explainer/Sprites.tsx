// The sprite layer: both characters, the speaker lit and the other one dimmed, the speaker's
// expression and a rest/open-mouth alternation every 0.15 s.
//
// One `Sequence` per line, so the pair swaps expression exactly when the speaker changes and nothing
// moves while nobody is speaking. Every sprite is a `useAsset` image inside a local `Suspense` — the
// shape `src/render/determinism/fixtures/references.tsx` calls `asset-suspense` — so a missing file
// is `asset.load-failed` at readiness, never a silently blank frame.
import { Sequence, useAsset, useTimeline, useTime } from '@kimuson/motion-kit';
import { Suspense } from 'react';

import {
  CHARACTERS,
  characterColor,
  framesToTime,
  mouthAt,
  px,
  spriteSource,
  type AssetsMode,
  type Character,
  type Expression,
  type Mouth,
} from './look.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';

/** The non-speaker is dimmed to 60%: the design doc's speaker highlight. */
const dimOpacity = 0.6;

type SpriteProps = {
  readonly character: Character;
  readonly expression: Expression;
  readonly mouth: Mouth;
  readonly assets: AssetsMode;
  readonly dim: boolean;
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

/**
 * A slot at one of the lower corners. `flat` draws a solid panel instead of the image: the probe
 * replaces the media step of this layer, because an image `useAsset` inside a `Sequence` is the
 * construct the design doc records as an intermittent determinism failure.
 *
 * The panel is an axis-aligned rectangle with square corners on purpose. A rounded corner is the one
 * antialiased edge this layer would otherwise have, and a fractionally transparent rounded corner
 * rasterises differently on the first paint after a mount than on the paints that follow: the gate
 * caught it at `explainer-probe` frame 23 in `reverse` (ten pixels of the top-right arc, at most 9/255
 * apart), which is the first frame of the sprite layer on the way down from 29. A corner with no
 * antialiasing has no first-paint history to differ from.
 */
const SpriteSlot = (props: SpriteProps & { readonly flat: boolean }) => {
  if (props.flat)
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: characterColor[props.character],
          opacity: props.dim ? dimOpacity : 0.9,
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
      />
    </Suspense>
  );
};

type LineSpritesProps = {
  readonly line: PlannedLine;
  readonly assets: AssetsMode;
  readonly flat: boolean;
};

/** The pair in view during one line: the speaker holds the line's expression and mouths, the other
 * one rests at `normal`. */
const LineSprites = ({ line, assets, flat }: LineSpritesProps) => {
  const time = useTime();
  const { width, height } = useTimeline();
  const box = {
    position: 'absolute' as const,
    width: px(height * 0.3),
    height: px(height * 0.56),
    bottom: 0,
  };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {CHARACTERS.map((character) => {
        const speaking = character === line.speaker;
        return (
          <div
            key={character}
            style={{
              ...box,
              ...(character === 'zundamon'
                ? { left: px(width * 0.012) }
                : { right: px(width * 0.012) }),
            }}
          >
            <SpriteSlot
              character={character}
              expression={speaking ? line.expression : 'normal'}
              mouth={speaking ? mouthAt(time) : 'rest'}
              assets={assets}
              dim={!speaking}
              flat={flat}
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
  readonly flat: boolean;
};

/**
 * One `Sequence` per line, each carrying both characters. The speaker is named on the subtitle band,
 * which is why the sprite layer needs no text of its own.
 */
export const Sprites = ({ storyboard, assets, flat }: SpritesProps) => (
  <>
    {storyboard.lines.map((line) => (
      <Sequence
        key={`sprites-${line.id}`}
        from={framesToTime(line.startFrame, storyboard.fps)}
        duration={framesToTime(line.frames, storyboard.fps)}
      >
        <LineSprites line={line} assets={assets} flat={flat} />
      </Sequence>
    ))}
  </>
);
