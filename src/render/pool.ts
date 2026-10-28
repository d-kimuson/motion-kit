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
  /** How many renderers capture at once, each in its own realm. A positive integer; the pool
   * opens no more renderers than the Composition has frames.
   *
   * Each renderer holds one frame queued behind the one it captures, and `queueTimeoutMs` runs
   * while it waits, so a queue budget shorter than one frame's capture aborts that frame.
   */
  readonly concurrency: number;
};

/** Several renderers of one Composition behind the frame-stream surface `renderVideo` reads. */
export type RendererPool = {
  /** The renderers actually opened: the requested concurrency, capped at the frame count. */
  readonly concurrency: number;
  readonly descriptor: () => LoadingDescriptor;
  /** Half-open [from, to) in frame order, whichever renderer captured each frame; stops at the
   * first failure or cancellation, like `Renderer.renderFrames`. The frames still in flight
   * when it stops run to completion and are discarded, so the pool stays usable afterwards.
   */
  readonly renderFrames: (options: RenderFramesOptions) => AsyncIterable<FrameCaptureResult>;
  readonly dispose: () => Promise<Result<undefined>>;
};

/** Half the machine's parallelism: each renderer is a browser that rasterises on its own cores.
 * Measured on the explainer, realms stop scaling at about 4 (render knowledge, capture throughput).
 */
export const defaultConcurrency = (parallelism = availableParallelism()): number =>
  Math.max(1, Math.floor(parallelism / 2));

const invalidConcurrency: Diagnostic = {
  code: 'cli.invalid-arguments',
  severity: 'error',
  message: 'The renderer concurrency is invalid.',
  hint: 'Use a positive integer concurrency.',
};

/**
 * Deals frames round-robin and yields them in frame order. Each renderer serialises its own
 * requests, so at most two frames per renderer are in flight: enough to keep every realm busy
 * while the oldest is consumed, and a queued frame waits behind one capture at most (the
 * `queueTimeoutMs` caveat on `RendererPoolOptions.concurrency`).
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
          ...(signal === undefined ? {} : { signal }),
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
    // Stopping early (a failure, or a consumer that returns) lets the frames in flight finish
    // rather than cancel them: a cancelled frame job recycles its realm, which would leave the
    // pool unusable. At most two frames per renderer remain, and the caller's signal still
    // cancels them.
    await Promise.allSettled(pending);
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
  // The first renderer reads the frame count, so a short Composition opens no idle browsers.
  const opening = await createRenderer(rendererOptions);
  if (!opening.ok) return opening;
  const first = opening.value;
  const extra = Math.min(concurrency, Math.max(1, first.descriptor().durationInFrames)) - 1;
  const opened = await Promise.all(
    Array.from({ length: extra }, () => createRenderer(rendererOptions)),
  );
  const renderers = [first, ...opened.flatMap((outcome) => (outcome.ok ? [outcome.value] : []))];
  const failed = opened.find((outcome) => !outcome.ok);
  if (failed !== undefined) {
    await Promise.all(renderers.map((renderer) => renderer.dispose()));
    return failed;
  }
  const dispose = async (): Promise<Result<undefined>> => {
    const results = await Promise.all(renderers.map((renderer) => renderer.dispose()));
    return results.find((result) => !result.ok) ?? { ok: true, value: undefined };
  };
  return {
    ok: true,
    value: {
      concurrency: renderers.length,
      descriptor: () => first.descriptor(),
      dispose,
      renderFrames: (framesOptions) =>
        renderers.length === 1
          ? first.renderFrames(framesOptions)
          : renderInterleaved(renderers, framesOptions, dispose),
    },
  };
};
