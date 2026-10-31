import { useTime } from '@kimuson/motion-kit';
import { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { CameraRig, type CameraPose } from './camera-rig.tsx';
import {
  differsFromAllZeros,
  mismatches,
  mount,
  pixelsOf,
  type Mounted,
} from './fixtures/harness.tsx';
import { ThreeCanvas } from './three-canvas.tsx';

const gl = { antialias: false } as const;
const pose = (time: number): CameraPose => ({
  position: [Math.sin(time * 0.7) * 1.4, 1 + Math.cos(time) * 0.4, 5 + Math.sin(time) * 0.5],
  lookAt: [0, 0, 0],
  fov: 45 + 10 * Math.sin(time),
  zoom: 1 + 0.1 * Math.sin(time),
});

const Cube = () => {
  const time = useTime();
  return (
    <mesh rotation={[Math.sin(time) * 0.2, time * 0.6, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#f6a02f" />
    </mesh>
  );
};

const cameraScene = (capture: Parameters<Parameters<typeof mount>[0]['scene']>[0]) => (
  <ThreeCanvas
    gl={gl}
    camera={{ fov: 45, near: 0.1, far: 100 }}
    onCreated={(state) => {
      capture.state = state;
    }}
  >
    <color attach="background" args={['#102030']} />
    <CameraRig pose={pose} />
    <Cube />
  </ThreeCanvas>
);

const camera = (instance: Mounted): PerspectiveCamera => {
  const value = instance.capture.state?.camera;
  if (!(value instanceof PerspectiveCamera))
    throw new Error('The default camera is not perspective');
  return value;
};

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (): Promise<Mounted> => {
  const instance = await mount({ scene: cameraScene });
  mounted.push(instance);
  return instance;
};

describe('CameraRig', () => {
  it('overwrites every pose field from absolute time', async () => {
    const instance = await open();
    expect((await instance.settle(6)).status).toBe('ready');
    const time = 6 / 30;
    const expected = pose(time);
    const target = camera(instance);
    expect(target.position.toArray()).toEqual([...expected.position]);
    expect(target.fov).toBe(expected.fov);
    expect(target.zoom).toBe(expected.zoom);
    expect(target.up.toArray()).toEqual([0, 1, 0]);
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);

  it('reproduces a fresh pose after a later frame instead of keeping history', async () => {
    const instance = await open();
    expect((await instance.settle(6)).status).toBe('ready');
    const reference = pixelsOf(instance.capture);
    const referencePose = pose(6 / 30);
    // A history-dependent rig (an interpolated or maximum-only pose) would keep frame 20's
    // camera here; the absolute overwrite must return to frame 6's exact pose and pixels.
    expect((await instance.settle(20)).status).toBe('ready');
    expect(mismatches(pixelsOf(instance.capture), reference)).toBeGreaterThan(0);
    expect((await instance.settle(6)).status).toBe('ready');
    expect(camera(instance).position.toArray()).toEqual([...referencePose.position]);
    expect(mismatches(pixelsOf(instance.capture), reference)).toBe(0);
    instance.dispose();
    const fresh = await open();
    expect((await fresh.settle(6)).status).toBe('ready');
    expect(camera(fresh).position.toArray()).toEqual([...referencePose.position]);
    expect(mismatches(pixelsOf(fresh.capture), reference)).toBe(0);
  }, 60_000);

  it('restores the projection the camera had at mount when a later frame omits fov and zoom', async () => {
    const stepped = (seconds: number): CameraPose =>
      seconds > 0.1 ? { position: [0, 0, 5], fov: 90, zoom: 2 } : { position: [0, 0, 5] };
    const instance = await mount({
      scene: (capture) => (
        <ThreeCanvas
          gl={gl}
          camera={{ fov: 45, near: 0.1, far: 100 }}
          onCreated={(state) => {
            capture.state = state;
          }}
        >
          <CameraRig pose={stepped} />
          <Cube />
        </ThreeCanvas>
      ),
    });
    mounted.push(instance);
    // Frame 6 is 0.2 s, so it sets the projection; frame 0 omits it. A rig that kept the previous
    // value would leave 90 and 2 here and depend on the frame rendered before it.
    expect((await instance.settle(6)).status).toBe('ready');
    expect(camera(instance).fov).toBe(90);
    expect(camera(instance).zoom).toBe(2);
    expect((await instance.settle(0)).status).toBe('ready');
    expect(camera(instance).fov).toBe(45);
    expect(camera(instance).zoom).toBe(1);
  }, 60_000);

  it('leaves the canvas Tier B', async () => {
    const instance = await open();
    expect((await instance.settle(0)).status).toBe('ready');
    expect(instance.runtime.warnings()).toEqual([]);
  }, 60_000);
});
