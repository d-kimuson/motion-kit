// The two characters, one in each side lane: Metan on the left, Zundamon on the right.
//
// Whoever has the line is lit, bobs with the speech and gets their colour's glow behind them; the
// other one dims and steps back a little, so the eye always knows who is talking. The line's
// `expression` becomes a small reaction beside the face — a "!" for surprise, a "?" for thinking,
// sparkles for happy — popping in as the line starts and fading after a couple of seconds.
//
//   assets: 'final'        the engine's own portrait (`fetch-assets.ts` writes it), a `useAsset`
//                          image inside a local `Suspense`, so a missing file is `asset.load-failed`
//                          at readiness, never a silently blank frame.
//   assets: 'placeholder'  a badge in the character's colour with their initial, so a fresh clone
//                          and CI draw a deliberate stand-in without any image file.
//
// The layer reads the frame instead of opening a `Sequence` per line: how lit a character is depends
// on their previous line as much as their current one (the dim fades in after they stop).
import { useAsset, useFrame, useTime } from '@kimuson/motion-kit';
import { Suspense, type ReactNode } from 'react';

import { DesignRect } from './flat.tsx';
import {
  CHARACTERS,
  DESIGN,
  PORTRAIT_HEIGHT,
  PORTRAIT_TOP,
  characterColor,
  characterInitial,
  characterInk,
  characterName,
  characterSide,
  palette,
  portraitAspect,
  portraitCentre,
  portraitFace,
  portraitSource,
  type AssetsMode,
  type Character,
  framesToSeconds,
  type Expression,
} from './look.ts';
import { enter, leave, popIn, sway } from './motion.ts';
import { type PlannedLine, type Storyboard } from './plan.ts';
import { useFlat } from './slides/shared.ts';

/** How long a reaction stays beside the face once the line starts. */
const REACTION_SECONDS = 2.6;

/** The character's state at a frame: how lit they are, and the line they are on, if any. */
type Presence = {
  readonly lit: number;
  readonly line: PlannedLine | undefined;
  /** Seconds into `line`, or since the character's last line ended when they are silent. */
  readonly local: number;
};

const presenceOf = (storyboard: Storyboard, character: Character, frame: number): Presence => {
  // The storyboard's frames are on its own grid, so its own rate converts them.
  const seconds = (frames: number) => framesToSeconds(frames, storyboard.fps);
  const last = storyboard.lines.findLast(
    (line) => line.speaker === character && line.startFrame <= frame,
  );
  if (last === undefined) return { lit: 0, line: undefined, local: 0 };
  const end = last.startFrame + last.frames;
  if (frame < end) {
    const local = seconds(frame - last.startFrame);
    return { lit: enter(local, 0, 0.25), line: last, local };
  }
  return { lit: leave(seconds(frame - end), 0, 0.35), line: undefined, local: 0 };
};

const portraitBox = (character: Character) => {
  const width = PORTRAIT_HEIGHT * portraitAspect[character];
  return {
    left: portraitCentre[character] - width / 2,
    top: PORTRAIT_TOP,
    width,
    height: PORTRAIT_HEIGHT,
  };
};

/** A four-pointed sparkle centred on its own origin. */
const sparkle = (size: number): string =>
  `M0 ${String(-size)} C${String(size * 0.15)} ${String(-size * 0.15)} ${String(size * 0.15)} ${String(-size * 0.15)} ${String(size)} 0 C${String(size * 0.15)} ${String(size * 0.15)} ${String(size * 0.15)} ${String(size * 0.15)} 0 ${String(size)} C${String(-size * 0.15)} ${String(size * 0.15)} ${String(-size * 0.15)} ${String(size * 0.15)} ${String(-size)} 0 C${String(-size * 0.15)} ${String(-size * 0.15)} ${String(-size * 0.15)} ${String(-size * 0.15)} 0 ${String(-size)} Z`;

const Glyph = ({
  children,
  color,
  size,
}: {
  readonly children: ReactNode;
  readonly color: string;
  readonly size: number;
}) => (
  <div
    style={{
      fontSize: size,
      fontWeight: 900,
      color,
      lineHeight: 1,
      WebkitTextStroke: `6px ${palette.groundTop}`,
      paintOrder: 'stroke fill',
    }}
  >
    {children}
  </div>
);

/** The reaction an expression draws, in a 160x160 box whose centre sits beside the face. */
const Reaction = ({ expression, t }: { readonly expression: Expression; readonly t: number }) => {
  switch (expression) {
    case 'surprised':
      return (
        <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ overflow: 'visible' }}>
          {[-50, -15, 20].map((angle) => (
            <line
              key={`burst-${String(angle)}`}
              x1={Math.cos((angle * Math.PI) / 180) * 30}
              y1={Math.sin((angle * Math.PI) / 180) * 30 - 10}
              x2={Math.cos((angle * Math.PI) / 180) * (30 + 34 * enter(t, 0, 0.25))}
              y2={Math.sin((angle * Math.PI) / 180) * (30 + 34 * enter(t, 0, 0.25)) - 10}
              stroke={palette.gold}
              strokeWidth={7}
              strokeLinecap="round"
            />
          ))}
          <foreignObject x={-36} y={-50} width={72} height={100}>
            <Glyph color={palette.gold} size={84}>
              !
            </Glyph>
          </foreignObject>
        </svg>
      );
    case 'thinking':
      return (
        <div
          style={{
            transform: `translateY(${String(sway(t, 1.6, 6))}px) rotate(${String(sway(t, 2.2, 8))}deg)`,
          }}
        >
          <Glyph color={palette.sky} size={88}>
            ?
          </Glyph>
        </div>
      );
    case 'happy':
    case 'wink':
      return (
        <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ overflow: 'visible' }}>
          {[
            { x: -20, y: -24, size: 26, phase: 0 },
            { x: 26, y: -2, size: 18, phase: 0.35 },
            { x: -4, y: 30, size: 14, phase: 0.7 },
          ].map((star) => (
            <path
              key={`star-${String(star.phase)}`}
              d={sparkle(
                star.size * (0.75 + 0.25 * Math.abs(Math.sin((t + star.phase) * Math.PI * 1.6))),
              )}
              transform={`translate(${String(star.x)} ${String(star.y)})`}
              fill={expression === 'wink' ? '#ff9ccc' : palette.gold}
            />
          ))}
        </svg>
      );
    case 'serious':
      return (
        <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ overflow: 'visible' }}>
          <path
            d="M0 -26 C10 -10 18 2 18 12 A18 18 0 0 1 -18 12 C-18 2 -10 -10 0 -26 Z"
            transform={`translate(0 ${String(14 * enter(t, 0.2, 1.6))})`}
            fill="#8fd3ff"
            stroke={palette.groundTop}
            strokeWidth={5}
          />
        </svg>
      );
    case 'normal':
      return null;
    default:
      return expression satisfies never;
  }
};

/** The fetched portrait, or the placeholder badge in its place. */
const Figure = ({
  character,
  assets,
}: {
  readonly character: Character;
  readonly assets: AssetsMode;
}) => (assets === 'final' ? <Portrait character={character} /> : <Badge character={character} />);

const Portrait = ({ character }: { readonly character: Character }) => {
  const image = useAsset({
    kind: 'image',
    id: `portrait-${character}`,
    source: portraitSource(character),
  });
  return <img alt="" src={image.src} style={{ display: 'block', width: '100%', height: '100%' }} />;
};

const Badge = ({ character }: { readonly character: Character }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      top: 70,
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: 230,
        height: 230,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, #ffffff55, ${characterColor[character]} 60%)`,
        border: `8px solid ${palette.text}`,
        color: characterInk[character],
        fontSize: 130,
        fontWeight: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {characterInitial[character]}
    </div>
  </div>
);

const Speaker = ({
  character,
  presence,
  t,
  assets,
}: {
  readonly character: Character;
  readonly presence: Presence;
  readonly t: number;
  readonly assets: AssetsMode;
}) => {
  const box = portraitBox(character);
  const { lit, line, local } = presence;
  const talking = line === undefined ? 0 : Math.abs(Math.sin(local * Math.PI * 3.1)) * lit;
  const breathe = 1 + 0.008 * Math.sin((t / 3.4) * Math.PI * 2 + (character === 'metan' ? 0 : 1.7));
  const scale = (0.95 + 0.05 * lit) * breathe;
  const face = portraitFace[character];
  const outward = characterSide[character] === 'left' ? -1 : 1;
  const reactionOn =
    line === undefined ? 0 : Math.min(1, leave(local, REACTION_SECONDS - 0.4, 0.4));
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: portraitCentre[character] - 260,
          top: PORTRAIT_TOP + 40,
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${characterColor[character]}55 0%, ${characterColor[character]}00 65%)`,
          opacity: lit,
        }}
      />
      <div
        style={{
          position: 'absolute',
          ...box,
          transformOrigin: '50% 100%',
          transform: `translateY(${String(-10 * talking)}px) scale(${String(scale)})`,
          filter: `brightness(${String(0.55 + 0.45 * lit)}) saturate(${String(0.6 + 0.4 * lit)}) drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff) drop-shadow(0 16px 24px rgba(0, 0, 0, 0.5))`,
        }}
      >
        <Figure character={character} assets={assets} />
      </div>
      {line === undefined || reactionOn <= 0 ? null : (
        <div
          style={{
            position: 'absolute',
            left: box.left + box.width * face.x + outward * 70 - 80,
            top: box.top + box.height * face.y - 150,
            width: 160,
            height: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...popIn(local, 0.05, 0.3),
            opacity: Math.min(enter(local, 0.05, 0.15), reactionOn),
          }}
        >
          <Reaction expression={line.expression} t={local} />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: portraitCentre[character] - 120,
          top: 1006,
          width: 240,
          display: 'flex',
          justifyContent: 'center',
          opacity: 0.6 + 0.4 * lit,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: characterColor[character],
            color: characterInk[character],
            fontSize: 26,
            fontWeight: 900,
            border: `3px solid ${palette.text}`,
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
          }}
        >
          {characterName[character]}
        </div>
      </div>
    </>
  );
};

export const Speakers = ({
  storyboard,
  assets,
}: {
  readonly storyboard: Storyboard;
  readonly assets: AssetsMode;
}) => {
  const frame = useFrame();
  const t = useTime();
  const flat = useFlat();
  if (flat)
    return (
      <>
        {CHARACTERS.map((character) => {
          const box = portraitBox(character);
          const speaking = presenceOf(storyboard, character, frame).line !== undefined;
          return (
            <DesignRect
              key={character}
              left={box.left + box.width * 0.2}
              top={box.top + 60}
              width={box.width * 0.6}
              height={DESIGN.height - box.top - 60}
              color={speaking ? characterColor[character] : palette.faint}
            />
          );
        })}
      </>
    );
  return (
    <Suspense fallback={null}>
      {CHARACTERS.map((character) => (
        <Speaker
          key={character}
          character={character}
          presence={presenceOf(storyboard, character, frame)}
          t={t}
          assets={assets}
        />
      ))}
    </Suspense>
  );
};
