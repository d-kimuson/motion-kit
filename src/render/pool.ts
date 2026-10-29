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
   * With multiple renderers, each holds one frame queued behind the one it captures, and
   * `queueTimeoutMs` runs while it waits. A single renderer submits frames sequentially.
   */
  readonly concurrency: number;
};

export type RenderFrameListOptions = {
  readonly frames: Iterable<number>;
  readonly signal?: AbortSignal;
  readonly format?: RenderFramesOptions['format'];
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
  /** Requested frames in list order, dealt round-robin with the same bounded window. */
  readonly renderFrameList: (options: RenderFrameListOptions) => AsyncIterable<FrameCaptureResult>;
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
 * requests, so at most two frames per renderer are in flight when there are multiple renderers.
 * A single renderer submits frames sequentially, without spending queue budget on prefetch.
 */
const renderInterleaved = async function* (
  renderers: readonly Renderer[],
  { frames, signal, format }: RenderFrameListOptions,
  dispose: () => Promise<Result<undefined>>,
): AsyncGenerator<FrameCaptureResult> {
  const window = renderers.length === 1 ? 1 : renderers.length * 2;
  const pending: { frame: number; result: Promise<FrameCaptureResult> }[] = [];
  const iterator = frames[Symbol.iterator]();
  let next = 0;
  const dispatch = () => {
    while (pending.length < window) {
      const item = iterator.next();
      if (item.done === true) break;
      const frame = item.value;
      const renderer = renderers[next % renderers.length];
      next += 1;
      if (renderer === undefined) throw new Error('A pool renderer index is out of range.');
      pending.push({
        frame,
        result: renderer.renderFrame({
          frame,
          ...(signal === undefined ? {} : { signal }),
          ...(format === undefined ? {} : { format }),
        }),
      });
    }
  };
  try {
    dispatch();
    for (let oldest = pending.shift(); oldest !== undefined; oldest = pending.shift()) {
      const result = await oldest.result;
      const descriptor = renderers[0]?.descriptor();
      if (
        !result.ok &&
        descriptor !== undefined &&
        frameRangeDiagnostic(oldest.frame, oldest.frame + 1, descriptor.durationInFrames) !==
          undefined
      )
        await dispose();
      yield result;
      if (!result.ok) return;
      dispatch();
    }
  } finally {
    // Stopping early (a failure, or a consumer that returns) lets the frames in flight finish
    // rather than cancel them: a cancelled frame job recycles its realm, which would leave the
    // pool unusable. At most two frames per renderer remain, and the caller's signal still
    // cancels them.
    try {
      iterator.return?.();
    } finally {
      await Promise.allSettled(pending.map(({ result }) => result));
    }
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
      renderFrameList: (listOptions) => renderInterleaved(renderers, listOptions, dispose),
      renderFrames: async function* (framesOptions) {
        const { from, to, signal, format } = framesOptions;
        const invalid = frameRangeDiagnostic(from, to, first.descriptor().durationInFrames);
        if (invalid !== undefined) {
          await dispose();
          yield { ok: false, error: [invalid] };
          return;
        }
        yield* renderInterleaved(
          renderers,
          {
            frames: (function* () {
              for (let frame = from; frame < to; frame++) yield frame;
            })(),
            signal,
            format,
          },
          dispose,
        );
      },
    },
  };
};
