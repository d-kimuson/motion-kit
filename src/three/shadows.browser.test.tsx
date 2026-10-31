import { useTime } from '@kimuson/motion-kit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  differsFromAllZeros,
  mismatches,
  mount,
  pixelsOf,
  type Mounted,
  type RootCapture,
} from './fixtures/harness.tsx';
import { freshMountsOf, orderCheck } from './fixtures/orders.ts';
import { ThreeCanvas } from './three-canvas.tsx';

const gl = { antialias: false } as const;
// The camera has to look down at the plane: from the default eye-level camera the shadowed area is
// out of view and the shadow map makes no visible difference at all.
const camera = { position: [0, 3, 5] as const, fov: 50 };

/** A rotating box over a receiving plane, lit by one directional light that casts the shadow. */
const Scene = ({ castShadow }: { readonly castShadow: boolean }) => {
  const time = useTime();
  return (
    <>
      <color attach="background" args={['#101820']} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[0, 5, 0.5]} intensity={3} castShadow={castShadow} />
      <mesh position={[0, 1.2, 0]} rotation={[0, time, 0]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#f6a02f" />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#dfe6f2" />
      </mesh>
    </>
  );
};

const shadowScene =
  (castShadow: boolean) =>
  (capture: RootCapture): ReturnType<typeof ThreeCanvas> => (
    <ThreeCanvas
      shadows
      gl={gl}
      camera={camera}
      onCreated={(state) => {
        capture.state = state;
      }}
    >
      <Scene castShadow={castShadow} />
    </ThreeCanvas>
  );

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (castShadow: boolean): Promise<{ instance: Mounted; capture: RootCapture }> => {
  const instance = await mount({ durationInFrames: 16, scene: shadowScene(castShadow) });
  mounted.push(instance);
  return { instance, capture: instance.capture };
};

describe('shadow maps', () => {
  it('is Tier B with shadows on: the same frame is byte-identical in any order', async () => {
    const frames = [0, 5, 11];
    const check = await orderCheck({
      frames,
      mount: { durationInFrames: 16 },
      scene: shadowScene(true),
    });
    for (const pixels of check.reference.values()) {
      expect(differsFromAllZeros(pixels)).toBe(true);
    }
    expect(check.referenceDifference).toBeGreaterThan(0);
    expect(check.shuffledMismatches).toEqual([0, 0, 0, 0, 0]);
    expect(check.fresh.mounts).toEqual(freshMountsOf(frames));
    expect(check.fresh.mismatches).toEqual([0, 0, 0]);
  }, 120_000);

  it('renders a shadow region that a light without castShadow does not', async () => {
    const shadowed = await open(true);
    const plain = await open(false);
    for (const frame of [0, 5]) {
      expect((await shadowed.instance.settle(frame)).status).toBe('ready');
      expect((await plain.instance.settle(frame)).status).toBe('ready');
      // The shadow covers roughly 3,500 of the 307,200 RGBA bytes here, all of them on the part of
      // the plane that would otherwise be lit.
      expect(mismatches(pixelsOf(shadowed.capture), pixelsOf(plain.capture))).toBeGreaterThan(1000);
    }
    expect(differsFromAllZeros(pixelsOf(plain.capture))).toBe(true);
  }, 120_000);
});
