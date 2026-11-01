import type { RootState } from '@react-three/fiber';

import {
  Composition,
  createCompositionRuntime,
  defineComposition,
  defineCompositions,
  type CompositionRuntime,
  type FrameOutcome,
  type Result,
} from '@kimuson/motion-kit';
import { type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

export type MountOptions = {
  /** The Composition's content. `capture` receives the R3F root of the canvas it renders. */
  readonly scene: (capture: RootCapture) => ReactNode;
  readonly width?: number;
  readonly height?: number;
  readonly durationInFrames?: number;
  /** The container's size at mount; `[0, 0]` exercises R3F's measurement before it renders. */
  readonly initialSize?: readonly [number, number];
  /** Mount as a dry realm does: a dry runtime, in a root of a document that never lays out. */
  readonly dry?: boolean;
};

export type RootCapture = {
  /** The R3F root the canvas created. It stays `undefined` until a frame has been settled, because
   * R3F creates its root only after it has measured the canvas. */
  state: RootState | undefined;
};

export type Mounted = {
  readonly runtime: CompositionRuntime;
  readonly container: HTMLDivElement;
  readonly capture: RootCapture;
  /** Render one output frame; a new request id per call, as the host does. */
  readonly settle: (frame: number) => Promise<FrameOutcome>;
  readonly settleWith: (frame: number, requestId: string) => Promise<FrameOutcome>;
  /** Every render this mount has run, one entry per `advance`: the frame it was asked for, in
   * request order, repeated when the runtime resettled. A mount that has not rendered is `[]`. */
  readonly rendered: readonly number[];
  readonly resize: (width: number, height: number) => void;
  readonly dispose: () => void;
};

/** Mount a real Composition with a real Composition runtime, the way the renderer does. */
export const mount = async ({
  scene,
  width = 320,
  height = 240,
  durationInFrames = 30,
  initialSize = [width, height],
  dry = false,
}: MountOptions): Promise<Mounted> => {
  const capture: RootCapture = { state: undefined };
  const registry = unwrap(
    defineCompositions([
      defineComposition({
        id: 'scene',
        width,
        height,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames,
        schema: z.object({}),
        component: () => scene(capture),
      }),
    ]),
  );
  const definition = unwrap(await registry.mount({ revision: 'browser' }));
  const runtime = createCompositionRuntime({
    definition,
    compositionRealm: 'page',
    instance: 'browser-test',
    dry,
  });
  const owner = dry ? document.implementation.createHTMLDocument('') : document;
  const container = owner.createElement('div');
  Object.assign(container.style, {
    width: `${initialSize[0]}px`,
    height: `${initialSize[1]}px`,
  });
  owner.body.append(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(<Composition definition={definition} compositionRuntime={runtime} />);
  });
  let requests = 0;
  const rendered: number[] = [];
  /** Settle and complete the capture, as the renderer's frame job does: an uncompleted
   * request keeps exclusive ownership, and the next frame would only queue. */
  const render = async (frame: number, requestId: string): Promise<FrameOutcome> => {
    rendered.push(frame);
    let outcome = await runtime.settleFrame(frame, { source: 'renderer', requestId });
    while (outcome.status === 'ready') {
      const completion = runtime.completeCapture(outcome.lease);
      if (completion.status === 'accepted') return outcome;
      if (completion.status !== 'resettle') return completion;
      rendered.push(frame);
      outcome = await runtime.resettle(outcome.lease);
    }
    return outcome;
  };
  return {
    runtime,
    container,
    capture,
    settle: (frame: number) => render(frame, `frame-${++requests}`),
    settleWith: (frame: number, requestId: string) => render(frame, requestId),
    get rendered() {
      return rendered.slice();
    },
    resize: (nextWidth, nextHeight) => {
      container.style.width = `${nextWidth}px`;
      container.style.height = `${nextHeight}px`;
    },
    dispose: () => {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    },
  };
};

/** The drawing buffer of a canvas the scene rendered into. */
export const pixels = (canvas: HTMLCanvasElement): Uint8Array => {
  const gl = canvas.getContext('webgl2');
  if (gl === null) throw new Error('WebGL2 is unavailable');
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  return bytes;
};

export const pixelsOf = (capture: RootCapture): Uint8Array => {
  if (capture.state === undefined) throw new Error('The canvas has no R3F root');
  return pixels(capture.state.gl.domElement);
};

/** Number of differing bytes; the comparison the spike used, without a checked-in golden. */
export const mismatches = (left: Uint8Array, right: Uint8Array): number => {
  if (left.length !== right.length) return Math.max(left.length, right.length);
  let count = 0;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) count++;
  return count;
};

export const differsFromAllZeros = (bytes: Uint8Array): boolean => bytes.some((byte) => byte !== 0);

/** Let queued React work, ResizeObserver callbacks and microtasks run. */
export const tick = async (): Promise<void> => {
  for (let round = 0; round < 3; round++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Settle without failing when the runtime keeps waiting (for the abort tests). */
export const within = async <T,>(promise: Promise<T>, ms = 2000): Promise<T | 'timeout'> => {
  const timer = Promise.withResolvers<'timeout'>();
  const handle = setTimeout(() => timer.resolve('timeout'), ms);
  try {
    return await Promise.race([promise, timer.promise]);
  } finally {
    clearTimeout(handle);
  }
};
