import { availableParallelism } from 'node:os';

import { type Diagnostic } from '../lib/diagnostic.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type Result } from '../lib/result.ts';
import { type FrameCaptureResult } from './capture/frame.ts';
import {
  createRenderer,
  frameRangeDiagnostic,
  type RenderFramesOptions,
  type RenderOutcome,
  type Renderer,
  type RendererOptions,
} from './renderer.ts';

export type RendererPoolOptions = RendererOptions & {
  /** How many renderers capture at once, each in its own realm. A positive integer. */
  readonly concurrency: number;
};

/** Several renderers of one Composition behind the frame-stream surface `renderVideo` reads. */
export type RendererPool = {
  readonly concurrency: number;
  readonly descriptor: () => LoadingDescriptor;
  /** Half-open [from, to) in frame order, whichever renderer captured each frame; stops at the
   * first failure or cancellation, exactly like `Renderer.renderFrames`.
   */
  readonly renderFrames: (options: RenderFramesOptions) => AsyncIterable<FrameCaptureResult>;
  readonly dispose: () => Promise<Result<undefined>>;
};

/** Half the machine's parallelism: each renderer is a browser that rasterises on its own cores. */
export const defaultConcurrency = (): number => Math.max(1, Math.floor(availableParallelism() / 2));

const invalidConcurrency: Diagnostic = {
  code: 'cli.invalid-arguments',
  severity: 'error',
  message: 'The renderer concurrency is invalid.',
  hint: 'Use a positive integer concurrency.',
};

/**
 * Deals frames round-robin and yields them in frame order. Each renderer serialises its own
 * requests, so at most two frames per renderer are in flight: enough to keep every realm busy
 * while the oldest is consumed, and few enough that a frame never waits near its queue budget.
 */
const renderInterleaved = async function* (
  renderers: readonly Renderer[],
  { from, to, signal, format }: RenderFramesOptions,
  dispose: () => Promise<Result<undefined>>,
): AsyncGenerator<FrameCaptureResult> {
  const descriptor = renderers[0]?.descriptor();
  const invalid =
    descriptor === undefined
      ? undefined
      : frameRangeDiagnostic(from, to, descriptor.durationInFrames);
  if (invalid !== undefined) {
    await dispose();
    yield { ok: false, error: [invalid] };
    return;
  }
  // Stopping early (a failure, or a consumer that returns) cancels every frame still in flight.
  const stop = new AbortController();
  const frameSignal = signal === undefined ? stop.signal : AbortSignal.any([signal, stop.signal]);
  const window = renderers.length * 2;
  const pending: Promise<FrameCaptureResult>[] = [];
  let next = from;
  const dispatch = () => {
    while (next < to && pending.length < window) {
      const frame = next;
      next += 1;
      const renderer = renderers[(frame - from) % renderers.length];
      if (renderer === undefined) throw new Error('A pool renderer index is out of range.');
      pending.push(
        renderer.renderFrame({
          frame,
          signal: frameSignal,
          ...(format === undefined ? {} : { format }),
        }),
      );
    }
  };
  try {
    dispatch();
    for (let oldest = pending.shift(); oldest !== undefined; oldest = pending.shift()) {
      const result = await oldest;
      yield result;
      if (!result.ok) return;
      dispatch();
    }
  } finally {
    stop.abort();
  }
};

/**
 * Opens `concurrency` renderers of the same Composition and props. A frame is a pure function of
 * its time and separate realms run independently (time-control ADR), so which realm captures a
 * frame does not change its bytes; the determinism suite's `concurrent` mode checks exactly that.
 */
export const createRendererPool = async (
  options: RendererPoolOptions,
): Promise<RenderOutcome<RendererPool>> => {
  const { concurrency, ...rendererOptions } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    return { ok: false, error: invalidConcurrency };
  const opened = await Promise.all(
    Array.from({ length: concurrency }, () => createRenderer(rendererOptions)),
  );
  const renderers = opened.flatMap((outcome) => (outcome.ok ? [outcome.value] : []));
  const failed = opened.find((outcome) => !outcome.ok);
  const first = renderers[0];
  if (failed !== undefined || first === undefined) {
    await Promise.all(renderers.map((renderer) => renderer.dispose()));
    return failed ?? { ok: false, aborted: true };
  }
  const dispose = async (): Promise<Result<undefined>> => {
    const results = await Promise.all(renderers.map((renderer) => renderer.dispose()));
    return results.find((result) => !result.ok) ?? { ok: true, value: undefined };
  };
  return {
    ok: true,
    value: {
      concurrency,
      descriptor: () => first.descriptor(),
      dispose,
      renderFrames: (framesOptions) =>
        renderers.length === 1
          ? first.renderFrames(framesOptions)
          : renderInterleaved(renderers, framesOptions, dispose),
    },
  };
};
