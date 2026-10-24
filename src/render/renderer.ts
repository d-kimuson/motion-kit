import { randomUUID } from 'node:crypto';

import { validateOutputFrame } from '../core/timeline/time.ts';
import { type MountReceipt, type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type Result } from '../lib/result.ts';
import { createFrameJob, type FrameCaptureResult, type FrameJob } from './capture/frame.ts';
import { pageTransport } from './capture/transport.ts';
import {
  openLoadingSession,
  type LoadingOutcome,
  type LoadingSessionOptions,
  type Selection,
} from './loading/session.ts';

export type RenderOutcome<T> = LoadingOutcome<T>;
export type RendererOptions = Omit<LoadingSessionOptions, 'acquire'> & Selection;
export type RenderFrameOptions = { frame: number; signal?: AbortSignal };
export type RenderFramesOptions = { from: number; to: number; signal?: AbortSignal };
export type Renderer = {
  /** PNG bytes, only after capture completion accepts the current lease. */
  renderFrame: (options: RenderFrameOptions) => Promise<FrameCaptureResult>;
  /** Half-open [from, to); stop at the first failure or cancellation. */
  renderFrames: (options: RenderFramesOptions) => AsyncIterable<FrameCaptureResult>;
  /** Fresh realm/props revision, same Vite session. Serialized with frame requests. */
  select: (selection: Selection) => Promise<RenderOutcome<MountReceipt>>;
  /** The mounted descriptor; reflects the latest select without a fresh realm. */
  descriptor: () => LoadingDescriptor;
  dispose: () => Promise<Result<undefined>>;
};

/** Owns one supervised loading session. Loading, caller/queue, and frame budgets
 * independently default to 30 seconds. Only ownership starts the frame budget.
 */
export const createRenderer = async (
  options: RendererOptions,
): Promise<RenderOutcome<Renderer>> => {
  const frameTimeoutMs = options.frameTimeoutMs ?? 30_000;
  const queueTimeoutMs = options.queueTimeoutMs ?? 30_000;
  if (![frameTimeoutMs, queueTimeoutMs].every((value) => Number.isFinite(value) && value > 0))
    return {
      ok: false,
      error: {
        code: 'cli.invalid-arguments',
        severity: 'error',
        message: 'Renderer budgets must be finite positive numbers.',
        hint: 'Supply positive frameTimeoutMs and queueTimeoutMs values.',
      },
    };
  let active: FrameJob | undefined;
  const claimed = new Map<string, number>();
  const opened = await openLoadingSession({
    ...options,
    acquire: (ownership) => {
      const key = JSON.stringify([ownership.source, ownership.instance, ownership.revision]);
      if ((claimed.get(key) ?? 0) >= ownership.generation || active?.grant(ownership) !== true)
        return false;
      claimed.set(key, ownership.generation);
      return true;
    },
  });
  if (!opened.ok) return opened;
  const session = opened.value;
  let disposed = false;
  const cancellation = new AbortController();
  const dispose = () => {
    disposed = true;
    cancellation.abort();
    return session.dispose();
  };
  const selected = await session.select({
    compositionId: options.compositionId,
    props: options.props,
  });
  if (!selected.ok) {
    await dispose();
    return selected;
  }
  let receipt = selected.value;
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const pending = tail.then(work);
    tail = pending.catch(() => {});
    return pending;
  };
  const renderFrame: Renderer['renderFrame'] = ({ frame, signal }) => {
    if (disposed || signal?.aborted === true || options.signal?.aborted === true)
      return Promise.resolve({ ok: false, aborted: true });
    const combined = AbortSignal.any([
      cancellation.signal,
      ...(options.signal === undefined ? [] : [options.signal]),
      ...(signal === undefined ? [] : [signal]),
    ]);
    // The job begins at submission, including any host selection/frame queue.
    // Select is serialized, so a queued frame binds the receipt when dequeued.
    const requestId = randomUUID();
    let queuedExpired = false;
    const queued = Promise.withResolvers<FrameCaptureResult>();
    const abortQueued = () => {
      queuedExpired = true;
      queued.resolve({ ok: false, aborted: true });
    };
    const queueTimer = setTimeout(abortQueued, queueTimeoutMs);
    const submitted = process.hrtime.bigint();
    combined.addEventListener('abort', abortQueued, { once: true });
    void enqueue(async () => {
      clearTimeout(queueTimer);
      combined.removeEventListener('abort', abortQueued);
      if (queuedExpired || disposed || combined.aborted) {
        abortQueued();
        return;
      }
      const remaining = queueTimeoutMs - Number(process.hrtime.bigint() - submitted) / 1e6;
      if (remaining <= 0) {
        abortQueued();
        return;
      }
      const checked = validateOutputFrame(frame, BigInt(receipt.descriptor.durationInFrames));
      if (!checked.ok) {
        await dispose();
        queued.resolve({ ok: false, error: [checked.error] });
        return;
      }
      const job = createFrameJob({
        requestId,
        frame,
        receipt,
        frameTimeoutMs,
        queueTimeoutMs: remaining,
        signal: combined,
        dispose,
      });
      active = job;
      try {
        const result = await job.run(pageTransport(session.page()));
        queued.resolve(result);
      } catch {
        const wasAborted = combined.aborted;
        await dispose();
        queued.resolve(
          wasAborted
            ? { ok: false, aborted: true }
            : {
                ok: false,
                error: [
                  {
                    code: 'render.page-error',
                    severity: 'error',
                    message: 'The selected realm is unavailable.',
                    hint: 'Create a new renderer after fixing the page or changed source.',
                  },
                ],
              },
        );
      } finally {
        active = undefined;
      }
    });
    return queued.promise;
  };
  return {
    ok: true,
    value: {
      dispose,
      renderFrame,
      descriptor: () => receipt.descriptor,
      select: (selection) =>
        enqueue(async () => {
          if (disposed) return { ok: false, aborted: true };
          const result = await session.select(selection);
          if (result.ok) receipt = result.value;
          else await dispose();
          return result;
        }),
      renderFrames: async function* ({ from, to, signal }) {
        if (
          !Number.isSafeInteger(to) ||
          to < from ||
          to > receipt.descriptor.durationInFrames ||
          !Number.isSafeInteger(from) ||
          from < 0
        ) {
          const invalid: FrameCaptureResult = {
            ok: false,
            error: [
              {
                code: 'composition.props-invalid',
                severity: 'error',
                message: 'The requested frame range is invalid.',
                hint: 'Use safe integer endpoints with 0 <= from <= to <= durationInFrames.',
              },
            ],
          };
          await dispose();
          yield invalid;
          return;
        }
        for (let frame = from; frame < to; frame++) {
          const result = await renderFrame({ frame, ...(signal === undefined ? {} : { signal }) });
          yield result;
          if (!result.ok) return;
        }
      },
    },
  };
};
export type { RenderedFrame } from './capture/frame.ts';
