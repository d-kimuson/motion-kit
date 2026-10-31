import { useFrame as useRenderFrame } from '@react-three/fiber';
import { z } from 'zod';

import { defineComposition, defineCompositions } from '../../core/composition/registry.ts';
import { useTime } from '../../core/timeline/hooks.ts';
import { CameraRig } from '../camera-rig.tsx';
import { ThreeCanvas } from '../three-canvas.tsx';

// A reference scene whose every animated value is a function of motion-kit time: 12 boxes,
// an orbiting camera and one shader-free basic material. It is small enough to keep the
// determinism suite inside its CI budget and still exercises transforms, a camera and the GPU.
const gl = { antialias: false, alpha: false } as const;

const Scene = () => {
  const time = useTime();
  return (
    <>
      <color attach="background" args={['#0b1020']} />
      <CameraRig
        pose={(seconds) => ({
          position: [
            Math.sin(seconds * 0.7) * 1.4,
            1 + Math.cos(seconds) * 0.4,
            5 + Math.sin(seconds) * 0.5,
          ],
          lookAt: [0, 0, 0],
          fov: 45,
        })}
      />
      {Array.from({ length: 12 }, (_, index) => (
        <mesh
          key={index}
          position={[
            ((index % 4) - 1.5) * 0.6,
            (Math.floor(index / 4) - 1) * 0.6,
            Math.sin(index) * 0.2,
          ]}
          rotation={[Math.sin(time + index) * 0.2, time * 0.6 + index, 0]}
        >
          <boxGeometry args={[0.22, 0.22, 0.22]} />
          <meshBasicMaterial color={index % 2 === 0 ? '#2f6df6' : '#f6a02f'} />
        </mesh>
      ))}
    </>
  );
};

/** A canvas with one `useFrame` subscriber: Tier C, usable but not certified. */
const Uncontrolled = () => {
  useRenderFrame(() => {});
  return <Scene />;
};

const metadata = {
  schema: z.object({}),
  width: 320,
  height: 240,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 8,
};

export const compositions = defineCompositions([
  defineComposition({
    ...metadata,
    id: 'three-canvas',
    component: () => (
      <ThreeCanvas gl={gl} camera={{ fov: 45, near: 0.1, far: 100 }} dpr={1}>
        <Scene />
      </ThreeCanvas>
    ),
  }),
  defineComposition({
    ...metadata,
    id: 'three-canvas-uncontrolled',
    component: () => (
      <ThreeCanvas gl={gl} camera={{ fov: 45, near: 0.1, far: 100 }} dpr={1}>
        <Uncontrolled />
      </ThreeCanvas>
    ),
  }),
]);
