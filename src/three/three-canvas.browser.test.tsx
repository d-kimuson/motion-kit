import { Sequence, useFrame, useSequence, useTime, useTimeline } from '@kimuson/motion-kit';
import { addEffect, useFrame as useRenderFrame } from '@react-three/fiber';
import { use } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  differsFromAllZeros,
  mismatches,
  mount,
  pixelsOf,
  tick,
  within,
  type Mounted,
} from './fixtures/harness.tsx';
import { ThreeCanvas } from './three-canvas.tsx';

const frames = [0, 4, 9, 14];
const gl = { antialias: false } as const;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (options: Parameters<typeof mount>[0]): Promise<Mounted> => {
  const instance = await mount(options);
  mounted.push(instance);
  return instance;
};

const Box = ({ time }: { readonly time: number }) => (
  <mesh
    rotation={[Math.sin(time) * 0.2, time * 0.6, 0]}
    position={[0, Math.sin(2 * time) * 0.2, 0]}
  >
    <boxGeometry args={[1, 1, 1]} />
    <meshBasicMaterial color="#2f6df6" />
  </mesh>
);

/** A scene that writes every animated value from motion-kit time. */
const Scene = () => {
  const time = useTime();
  return (
    <>
      <color attach="background" args={['#102030']} />
      <Box time={time} />
    </>
  );
};

const canvasScene = (capture: Parameters<Parameters<typeof mount>[0]['scene']>[0]) => (
  <ThreeCanvas
    gl={gl}
    onCreated={(state) => {
      capture.state = state;
    }}
  >
    <Scene />
  </ThreeCanvas>
);

describe('ThreeCanvas', () => {
  it('exposes motion-kit time hooks inside the R3F reconciler', async () => {
    const observed: Record<string, number | undefined> = {};
    const observe = (name: string, value: number) => {
      observed[name] = value;
    };
    const Global = () => {
      observe('frame', useFrame());
      observe('globalTime', useTimeline().globalTime);
      observe('width', useTimeline().width);
      observe('sequenceDuration', useSequence().duration);
      return <Box time={0} />;
    };
    const Local = () => {
      observe('localTime', useTime());
      observe('localDuration', useSequence().duration);
      return <Box time={0} />;
    };
    const instance = await open({
      scene: (capture) => (
        <ThreeCanvas
          gl={gl}
          onCreated={(state) => {
            capture.state = state;
          }}
        >
          <Global />
          <Sequence from={0.05} duration={0.2}>
            <Local />
          </Sequence>
        </ThreeCanvas>
      ),
    });
    expect((await instance.settle(3)).status).toBe('ready');
    expect(observed['frame']).toBe(3);
    expect(observed['globalTime']).toBeCloseTo(0.1, 10);
    expect(observed['width']).toBe(320);
    expect(observed['sequenceDuration']).toBeCloseTo(1, 10);
    expect(observed['localTime']).toBeCloseTo(0.05, 10);
    expect(observed['localDuration']).toBeCloseTo(0.2, 10);
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
    expect(instance.runtime.warnings()).toEqual([]);
  }, 60_000);

  it('does not advance or capture before R3F has measured a non-zero size', async () => {
    const instance = await open({ scene: canvasScene, initialSize: [0, 0] });
    const pending = instance.settle(0);
    expect(await within(pending, 300)).toBe('timeout');
    expect(instance.capture.state).toBeUndefined();
    instance.resize(320, 240);
    const outcome = await pending;
    expect(outcome.status).toBe('ready');
    expect(instance.capture.state).toBeDefined();
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);

  it('reproduces identical canvas pixels for sequential, random, repeated and fresh frames', async () => {
    const instance = await open({ scene: canvasScene });
    const reference = new Map<number, Uint8Array>();
    for (let frame = 0; frame <= 14; frame++) {
      expect((await instance.settle(frame)).status).toBe('ready');
      if (frames.includes(frame)) reference.set(frame, pixelsOf(instance.capture));
    }
    for (const frame of frames) {
      const pixels = reference.get(frame);
      if (pixels === undefined) throw new Error(`missing reference for frame ${frame}`);
      expect(differsFromAllZeros(pixels)).toBe(true);
    }
    // Distinct frames must differ, or a constant capture would pass the comparisons below.
    expect(
      mismatches(reference.get(0) ?? new Uint8Array(), reference.get(14) ?? new Uint8Array()),
    ).toBeGreaterThan(0);
    for (const frame of [14, 0, 9, 4, 9, 14]) {
      expect((await instance.settle(frame)).status).toBe('ready');
      expect(mismatches(pixelsOf(instance.capture), reference.get(frame) ?? new Uint8Array())).toBe(
        0,
      );
    }
    const clock = instance.capture.state?.clock.elapsedTime;
    await tick();
    expect(instance.capture.state?.clock.elapsedTime).toBe(clock ?? 0);
    expect(mismatches(pixelsOf(instance.capture), reference.get(14) ?? new Uint8Array())).toBe(0);
    instance.dispose();
    const fresh = await open({ scene: canvasScene });
    for (const frame of frames) {
      expect((await fresh.settle(frame)).status).toBe('ready');
      expect(mismatches(pixelsOf(fresh.capture), reference.get(frame) ?? new Uint8Array())).toBe(0);
    }
  }, 120_000);

  it('advances only its own root, never another canvas or a global effect', async () => {
    const effects: number[] = [];
    const removeEffect = addEffect((timestamp) => effects.push(timestamp));
    try {
      const left = await open({ scene: canvasScene });
      const right = await open({ scene: canvasScene });
      expect((await left.settle(0)).status).toBe('ready');
      expect((await right.settle(0)).status).toBe('ready');
      const resting = pixelsOf(right.capture);
      expect(differsFromAllZeros(resting)).toBe(true);
      for (const frame of [1, 2]) expect((await left.settle(frame)).status).toBe('ready');
      expect(left.capture.state?.clock.elapsedTime).toBeCloseTo(2 / 30, 10);
      expect(right.capture.state?.clock.elapsedTime).toBe(0);
      // Advancing the left canvas left the right canvas's drawing buffer untouched.
      expect(mismatches(pixelsOf(right.capture), resting)).toBe(0);
      expect((await right.settle(2)).status).toBe('ready');
      expect(right.capture.state?.clock.elapsedTime).toBeCloseTo(2 / 30, 10);
      expect(mismatches(pixelsOf(right.capture), resting)).toBeGreaterThan(0);
      expect(left.capture.state?.clock.elapsedTime).toBeCloseTo(2 / 30, 10);
      expect(effects).toEqual([]);
    } finally {
      removeEffect();
    }
  }, 120_000);

  it('reports seek.uncontrolled when a useFrame subscriber makes the canvas Tier C', async () => {
    let calls = 0;
    const Integrator = () => {
      useRenderFrame(() => {
        calls++;
      });
      return null;
    };
    const instance = await open({
      scene: (capture) => (
        <ThreeCanvas
          gl={gl}
          onCreated={(state) => {
            capture.state = state;
          }}
        >
          <Scene />
          <Integrator />
        </ThreeCanvas>
      ),
    });
    expect(instance.runtime.warnings()).toEqual([]);
    expect((await instance.settle(0)).status).toBe('ready');
    expect(instance.runtime.warnings()).toMatchObject([
      { code: 'seek.uncontrolled', severity: 'warning' },
    ]);
    // Tier C stays usable: the frame still settles and the callback runs once per advance.
    for (const frame of [1, 2]) expect((await instance.settle(frame)).status).toBe('ready');
    expect(calls).toBe(3);
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);

  it('waits for a suspending child before the canvas commits or settles', async () => {
    const gate = Promise.withResolvers<void>();
    const committed: number[] = [];
    const Suspending = () => {
      use(gate.promise);
      return <Box time={0.5} />;
    };
    const Committed = () => {
      committed.push(1);
      return null;
    };
    const instance = await open({
      scene: (capture) => (
        <ThreeCanvas
          gl={gl}
          onCreated={(state) => {
            capture.state = state;
          }}
        >
          <color attach="background" args={['#102030']} />
          <Suspending />
          <Committed />
        </ThreeCanvas>
      ),
    });
    const pending = instance.settle(0);
    await tick();
    // The Suspense fallback is committed instead of the content, so nothing inside the
    // boundary has reported a generation and settlement must still be waiting.
    expect(committed).toEqual([]);
    expect(await within(pending, 300)).toBe('timeout');
    gate.resolve();
    expect((await pending).status).toBe('ready');
    expect(committed.length).toBeGreaterThan(0);
    expect([...new Set(committed)]).toEqual([1]);
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);

  it('resolves an aborted wait promptly and serves the next frame', async () => {
    const gate = Promise.withResolvers<void>();
    const Suspending = () => {
      use(gate.promise);
      return <Box time={0} />;
    };
    const instance = await open({
      scene: (capture) => (
        <ThreeCanvas
          gl={gl}
          onCreated={(state) => {
            capture.state = state;
          }}
        >
          <Suspending />
        </ThreeCanvas>
      ),
    });
    const pending = instance.settleWith(0, 'suspend-0');
    await tick();
    expect(await within(pending, 300)).toBe('timeout');
    instance.runtime.cancel('suspend-0');
    expect(await within(pending, 1000)).toEqual({ status: 'aborted' });
    gate.resolve();
    const next = await within(instance.settle(1), 5000);
    expect(next).toMatchObject({ status: 'ready' });
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);
});
