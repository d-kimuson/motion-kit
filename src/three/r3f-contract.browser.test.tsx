import { addEffect, advance, useFrame as useRenderFrame, type RootState } from '@react-three/fiber';
import { afterEach, describe, expect, it } from 'vitest';

import { differsFromAllZeros, mount, pixelsOf, tick, type Mounted } from './fixtures/harness.tsx';
import { ThreeCanvas } from './three-canvas.tsx';

// The contract `ThreeCanvas` depends on: R3F's manual advance, its `frameloop="never"` clock and
// the `internal.subscribers` array the canvas is classified by. An R3F upgrade that changes any of
// these has to fail here rather than degrade a render quietly.
const gl = { antialias: false } as const;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (
  options: Omit<Parameters<typeof mount>[0], 'scene'> & {
    children?: Parameters<typeof ThreeCanvas>[0]['children'];
  },
): Promise<{ instance: Mounted; state: RootState }> => {
  const instance = await mount({
    ...options,
    scene: (capture) => (
      <ThreeCanvas
        gl={gl}
        onCreated={(state) => {
          capture.state = state;
        }}
      >
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#2f6df6" />
        </mesh>
        {options.children ?? null}
      </ThreeCanvas>
    ),
  });
  mounted.push(instance);
  // R3F creates its root only once the canvas has been measured; settling the first frame is what
  // the renderer does and what makes `onCreated` have run.
  expect((await instance.settle(0)).status).toBe('ready');
  const state = instance.capture.state;
  if (state === undefined) throw new Error('The canvas was not created during mount.');
  return { instance, state };
};

/** Counts the renders of one root by wrapping the renderer's own render call. */
const countRenders = (state: RootState): number[] => {
  const renders: number[] = [];
  const render = state.gl.render.bind(state.gl);
  state.gl.render = (scene, camera) => {
    renders.push(renders.length);
    render(scene, camera);
  };
  return renders;
};

describe('R3F contract', () => {
  it('renders exactly once per advance(timestamp, false) and never by itself', async () => {
    const { state } = await open({});
    const renders = countRenders(state);
    expect(state.frameloop).toBe('never');
    expect(typeof state.advance).toBe('function');

    await tick();
    expect(renders).toHaveLength(0);
    expect(state.clock.elapsedTime).toBe(0);

    state.advance(0.1, false);
    expect(renders).toHaveLength(1);
    expect(state.clock.elapsedTime).toBeCloseTo(0.1, 10);

    await tick();
    expect(renders).toHaveLength(1);
    state.advance(0.2, false);
    expect(renders).toHaveLength(2);
  }, 60_000);
  it('advances only the root it was called on, and no global effect', async () => {
    const left = await open({});
    const right = await open({});
    const leftRenders = countRenders(left.state);
    const rightRenders = countRenders(right.state);
    const effects: number[] = [];
    const removeEffect = addEffect((timestamp) => effects.push(timestamp));
    try {
      left.state.advance(0.1, false);
      expect(leftRenders).toHaveLength(1);
      expect(rightRenders).toHaveLength(0);
      expect(right.state.clock.elapsedTime).toBe(0);
      expect(effects).toEqual([]);

      // The contrast: the module-level advance with global effects on is what a canvas must never
      // do, because it renders every root and runs every global effect.
      advance(0.3, true);
      expect(leftRenders).toHaveLength(2);
      expect(rightRenders).toHaveLength(1);
      expect(effects).toHaveLength(1);
    } finally {
      removeEffect();
    }
  }, 60_000);

  it('counts its useFrame subscribers in the internal subscribers array', async () => {
    const Subscriber = ({ name }: { readonly name: string }) => {
      useRenderFrame(() => name);
      return null;
    };
    const plain = await open({});
    expect(Array.isArray(plain.state.internal.subscribers)).toBe(true);
    expect(plain.state.internal.subscribers).toHaveLength(0);

    const subscribed = await open({
      children: (
        <>
          <Subscriber name="first" />
          <Subscriber name="second" />
        </>
      ),
    });
    await tick();
    expect(subscribed.state.internal.subscribers).toHaveLength(2);
    // The canvas is classified by that count, so the subscriber is also what makes it Tier C.
    expect(subscribed.instance.runtime.warnings()).toMatchObject([{ code: 'seek.uncontrolled' }]);
  }, 60_000);

  it('hands a useFrame subscriber the timestamp delta of the frame it advances to', async () => {
    const deltas: number[] = [];
    const Subscriber = () => {
      useRenderFrame((_, delta) => deltas.push(delta));
      return null;
    };
    const { instance, state } = await open({ children: <Subscriber /> });
    deltas.length = 0;
    expect((await instance.settle(3)).status).toBe('ready');
    expect(deltas).toEqual([expect.closeTo(0.1, 10)]);
    expect((await instance.settle(9)).status).toBe('ready');
    expect(deltas).toHaveLength(2);
    expect(deltas[1]).toBeCloseTo(0.2, 10);
    expect(state.clock.elapsedTime).toBeCloseTo(0.3, 10);
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
  }, 60_000);
});
