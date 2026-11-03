import { useSequence } from '@kimuson/motion-kit';
import { CameraRig, ThreeCanvas } from '@kimuson/motion-kit/three';
import { useMemo } from 'react';

import { headings, threeCaption } from './copy.ts';
import { CHALK, CYAN, INK, MONO, MUTED, PANEL_EDGE, VIOLET } from './look.ts';
import { ease, pop } from './motion.ts';
import { Heading } from './parts.tsx';
import {
  ballOnCard,
  CARD_COUNT,
  CARD_FRAME_STEP,
  CARD_HEIGHT,
  CARD_WIDTH,
  cameraPose,
  cardArrival,
  cardLift,
  cardRest,
  playheadX,
} from './strip.ts';

const TEXTURE_WIDTH = 640;
const TEXTURE_HEIGHT = 360;

/** One card's face, drawn once into a 2D canvas: the frame number, its time and where the clip's
 * ball is on that frame, over the faint path of every other frame. */
const drawCard = (index: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) return canvas;
  const ground = context.createLinearGradient(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  ground.addColorStop(0, '#171c38');
  ground.addColorStop(1, '#0c1021');
  context.fillStyle = ground;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  const at = (other: number) => {
    const [x, y] = ballOnCard(other);
    return [x * TEXTURE_WIDTH, y * TEXTURE_HEIGHT] as const;
  };
  context.fillStyle = `${MUTED}55`;
  for (let other = 0; other < CARD_COUNT; other += 1) {
    const [x, y] = at(other);
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.fill();
  }
  const [x, y] = at(index);
  context.fillStyle = CYAN;
  context.beginPath();
  context.arc(x, y, 30, 0, Math.PI * 2);
  context.fill();
  const frame = index * CARD_FRAME_STEP;
  context.fillStyle = CHALK;
  context.font = `700 54px ${MONO}`;
  context.fillText(`frame ${String(frame).padStart(3, '0')}`, 36, 80);
  context.fillStyle = MUTED;
  context.font = `38px ${MONO}`;
  context.fillText(`t = ${(frame / 30).toFixed(2)} s`, 36, 132);
  return canvas;
};

/** A frame card: a lit slab with the face on its front. It drops into the strip, then lifts out
 * towards the camera while the playhead passes it. */
const Card = ({ index, time }: { readonly index: number; readonly time: number }) => {
  const face = useMemo(() => drawCard(index), [index]);
  const [x, y, z] = cardRest(index);
  const arrive = pop(time, cardArrival(index));
  const shown = Math.max(0, Math.min(1, arrive));
  const lift = cardLift(index, time);
  return (
    <group
      position={[x, y + lift * 0.5 + (1 - arrive) * 2.4, z + lift * 1.1]}
      rotation={[-0.12 * (1 - lift), (1 - arrive) * 0.6, 0]}
      scale={1 + lift * 0.1}
    >
      <mesh>
        <boxGeometry args={[CARD_WIDTH + 0.1, CARD_HEIGHT + 0.1, 0.06]} />
        <meshStandardMaterial
          color={PANEL_EDGE}
          emissive={CYAN}
          emissiveIntensity={lift * 0.9}
          roughness={0.45}
          metalness={0.3}
          transparent
          opacity={shown}
        />
      </mesh>
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={shown}>
          <canvasTexture attach="map" args={[face]} colorSpace="srgb" anisotropy={8} />
        </meshBasicMaterial>
      </mesh>
    </group>
  );
};

/** The playhead: a glowing upright that sweeps the strip, on a rail under the cards. */
const Playhead = ({ time }: { readonly time: number }) => {
  const shown = ease(time, [0.8, 1.1], [0, 1]);
  const first = cardRest(0)[0];
  const last = cardRest(CARD_COUNT - 1)[0];
  return (
    <>
      <mesh position={[(first + last) / 2, -0.78, 0.4]}>
        <boxGeometry args={[last - first + 2.4, 0.03, 0.03]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.55} />
      </mesh>
      <mesh position={[playheadX(time), -0.45, 0.62]}>
        <boxGeometry args={[0.035, 0.66, 0.035]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} transparent opacity={shown} />
      </mesh>
      <mesh position={[playheadX(time), -0.78, 0.62]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.16, 0.16, 0.05]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} transparent opacity={shown} />
      </mesh>
    </>
  );
};

/** The playhead's frame and time under the strip, in the same words the cards use. */
const Readout = ({ time }: { readonly time: number }) => {
  const shown = ease(time, [1.0, 1.4], [0, 1]);
  const along = (playheadX(time) - cardRest(0)[0]) / (cardRest(CARD_COUNT - 1)[0] - cardRest(0)[0]);
  const frame = Math.round(along * (CARD_COUNT - 1) * CARD_FRAME_STEP);
  return (
    <div
      style={{
        position: 'absolute',
        left: 140,
        bottom: 96,
        fontFamily: MONO,
        fontSize: 26,
        color: MUTED,
        opacity: shown,
      }}
    >
      playhead → <span style={{ color: CYAN }}>frame {String(frame).padStart(3, '0')}</span>
    </div>
  );
};

/** Three.js on the same timeline: a strip of frame cards in 3D, a playhead sweeping it and a camera
 * craning over it, every transform derived from the scene's time inside `ThreeCanvas`. */
export const ThreeScene = () => {
  const { time } = useSequence();
  const caption = pop(time, 2.2);
  const point = playheadX(time);
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 250, width: 1920, height: 830 }}>
        <ThreeCanvas resize={{ offsetSize: true }} gl={{ antialias: true, alpha: true }}>
          <fog attach="fog" args={[INK, 8, 17]} />
          <CameraRig pose={cameraPose} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 6, 5]} intensity={1.6} />
          <pointLight position={[point, 1.2, 1.6]} color={CYAN} intensity={8} distance={4.5} />
          {Array.from({ length: CARD_COUNT }, (_, index) => (
            <Card key={`card-${String(index)}`} index={index} time={time} />
          ))}
          <Playhead time={time} />
          <gridHelper args={[40, 40, PANEL_EDGE, PANEL_EDGE]} position={[0, -1.2, 0]} />
        </ThreeCanvas>
      </div>
      <Heading kicker={headings.three.kicker} title={headings.three.title} />
      <div
        style={{
          position: 'absolute',
          right: 140,
          bottom: 92,
          display: 'flex',
          gap: 14,
          opacity: Math.min(1, Math.max(0, caption)),
          transform: `translateY(${(1 - caption) * 24}px)`,
        }}
      >
        {threeCaption.map((item) => (
          <div
            key={item}
            style={{
              fontFamily: MONO,
              fontSize: 24,
              color: CHALK,
              padding: '10px 20px',
              borderRadius: 999,
              border: `1.5px solid ${PANEL_EDGE}`,
              background: '#121628e6',
            }}
          >
            {item}
          </div>
        ))}
      </div>
      <Readout time={time} />
    </>
  );
};
