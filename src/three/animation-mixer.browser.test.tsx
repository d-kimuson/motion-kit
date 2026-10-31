import { useTime } from '@kimuson/motion-kit';
import { useFrame as useRenderFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { AnimationClip, AnimationMixer, NumberKeyframeTrack } from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import {
  differsFromAllZeros,
  mount,
  pixelsOf,
  type Mounted,
  type RootCapture,
} from './fixtures/harness.tsx';
import { orderCheck } from './fixtures/orders.ts';
import { ThreeCanvas } from './three-canvas.tsx';

const gl = { antialias: false } as const;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (options: Parameters<typeof mount>[0]): Promise<Mounted> => {
  const instance = await mount({ ...options, durationInFrames: 16 });
  mounted.push(instance);
  return instance;
};

/** The clip three interpolates: the mover travels from x -1.2 to 1.2 over the first 0.4 s. Its
 * duration (1 s) stays past the Composition's last frame, because a finished LoopOnce action is
 * deactivated by three and stops applying the clip from that update on. */
const clip = new AnimationClip('travel', 1, [
  new NumberKeyframeTrack('mover.position[x]', [0, 0.2, 0.4], [-1.2, 0, 1.2]),
]);

const moverX = (capture: RootCapture): number | undefined =>
  capture.state?.scene.getObjectByName('mover')?.position.x;

/** Tier B: the mixer is positioned absolutely from motion-kit time, so it carries no history. */
const AbsoluteMover = ({ track }: { readonly track: AnimationClip }) => {
  const time = useTime();
  const scene = useThree((state) => state.scene);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  useLayoutEffect(() => {
    mixer.clipAction(track).play();
    mixer.setTime(time);
  }, [mixer, time, track]);
  return <Mover />;
};

/** Tier C: the mixer integrates the delta R3F hands to `useFrame`, so motion-kit cannot
 * distinguish its state from a callback that carries history. */
const IntegratedMover = ({ track }: { readonly track: AnimationClip }) => {
  const scene = useThree((state) => state.scene);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  useLayoutEffect(() => {
    mixer.clipAction(track).play();
  }, [mixer, track]);
  useRenderFrame((_, delta) => {
    mixer.update(delta);
  });
  return <Mover />;
};

const Mover = () => (
  <mesh name="mover">
    <boxGeometry args={[0.8, 0.8, 0.8]} />
    <meshBasicMaterial color="#f6a02f" />
  </mesh>
);

const canvas = (capture: RootCapture, children: Parameters<typeof ThreeCanvas>[0]['children']) => (
  <ThreeCanvas
    gl={gl}
    onCreated={(state) => {
      capture.state = state;
    }}
  >
    <color attach="background" args={['#102030']} />
    {children}
  </ThreeCanvas>
);

describe('AnimationMixer', () => {
  it('is Tier B when it is positioned absolutely with mixer.setTime from motion-kit time', async () => {
    const frames = [0, 6, 12];
    const check = await orderCheck({
      frames,
      scene: (capture) => canvas(capture, <AbsoluteMover track={clip} />),
    });
    for (const pixels of check.reference.values()) {
      expect(differsFromAllZeros(pixels)).toBe(true);
    }
    expect(check.referenceDifference).toBeGreaterThan(0);
    expect(check.shuffledMismatches).toEqual([0, 0, 0, 0, 0]);
    expect(check.freshMismatches).toEqual([0, 0, 0]);
  }, 120_000);

  it('writes the clip value the frame asks for, not the value the previous frame left', async () => {
    const instance = await open({
      scene: (capture) => canvas(capture, <AbsoluteMover track={clip} />),
    });
    for (const [frame, expected] of [
      [0, -1.2],
      [6, 0],
      [12, 1.2],
      [3, -0.6],
    ] as const) {
      expect((await instance.settle(frame)).status).toBe('ready');
      expect(moverX(instance.capture)).toBeCloseTo(expected, 5);
    }
    expect(instance.runtime.warnings()).toEqual([]);
  }, 60_000);

  it('is Tier C when it integrates mixer.update(delta) in useFrame', async () => {
    const instance = await open({
      scene: (capture) => canvas(capture, <IntegratedMover track={clip} />),
    });
    expect(instance.runtime.warnings()).toEqual([]);
    expect((await instance.settle(0)).status).toBe('ready');
    expect(instance.runtime.warnings()).toMatchObject([
      { code: 'seek.uncontrolled', severity: 'warning' },
    ]);
    expect((await instance.settle(6)).status).toBe('ready');
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);
});
