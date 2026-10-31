import { useTime } from '@kimuson/motion-kit';
import { useFrame as useRenderFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import {
  mismatches,
  mount,
  pixelsOf,
  type Mounted,
  type RootCapture,
} from './fixtures/harness.tsx';
import { ThreeCanvas } from './three-canvas.tsx';

// The negative control behind the "controls and damping" exclusion: a camera that eases towards a
// time-dependent target from its previous pose is history-dependent, so the same frame lands on a
// different pose depending on the frames rendered before it.
const gl = { antialias: false } as const;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (): Promise<{ instance: Mounted; capture: RootCapture }> => {
  const instance = await mount({
    scene: (capture) => (
      <ThreeCanvas
        gl={gl}
        onCreated={(state) => {
          capture.state = state;
        }}
      >
        <color attach="background" args={['#102030']} />
        <Damped />
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#2f6df6" />
        </mesh>
      </ThreeCanvas>
    ),
  });
  mounted.push(instance);
  return { instance, capture: instance.capture };
};

/** An `OrbitControls`-shaped damping loop: the next pose is a fraction of the way from the current
 * one to a target that moves with time. */
const Damped = () => {
  const camera = useThree((state) => state.camera);
  const time = useTime();
  const target = useMemo(() => new Vector3(), []);
  useRenderFrame(() => {
    target.set(Math.sin(time * 2) * 2, Math.cos(time * 2) * 1.5, 4);
    camera.position.lerp(target, 0.25);
    camera.lookAt(0, 0, 0);
  });
  return null;
};

describe('camera damping', () => {
  it('reports seek.uncontrolled and reaches a different pose when the frame is sought first', async () => {
    const sequential = await open();
    for (let frame = 0; frame <= 9; frame++) {
      expect((await sequential.instance.settle(frame)).status).toBe('ready');
    }
    expect(sequential.instance.runtime.warnings()).toMatchObject([
      { code: 'seek.uncontrolled', severity: 'warning' },
    ]);

    const fresh = await open();
    expect((await fresh.instance.settle(9)).status).toBe('ready');
    expect(fresh.instance.runtime.warnings()).toMatchObject([{ code: 'seek.uncontrolled' }]);
    expect(mismatches(pixelsOf(sequential.capture), pixelsOf(fresh.capture))).toBeGreaterThan(0);
  }, 120_000);
});
