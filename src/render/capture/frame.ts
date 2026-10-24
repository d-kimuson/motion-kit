import { createFrameRate, frameToTime, toSeconds } from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Ownership } from '../../lib/frame-protocol.ts';
import { type MountReceipt } from '../../lib/loading-protocol.ts';
import { type LoadingOutcome } from '../loading/session.ts';
import { type FrameTransport } from './transport.ts';

export type RenderedFrame = Readonly<{
  frame: number;
  width: number;
  height: number;
  png: Buffer;
  diagnostics: readonly Diagnostic[];
}>;
export type FrameJob = {
  grant: (ownership: Ownership) => boolean;
  run: (transport: FrameTransport) => Promise<LoadingOutcome<RenderedFrame>>;
  result: Promise<LoadingOutcome<RenderedFrame>>;
  pending: () => boolean;
};
const aborted = { ok: false, aborted: true } as const;
const redactSource = (source: string): string => {
  try {
    const url = new URL(source);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[asset source]';
  }
};
/** A request's queue watchdog starts at submission. Only a matching host grant
 * replaces it with the single monotonic frame deadline, retained through capture.
 */
export const createFrameJob = (options: {
  requestId: string;
  frame: number;
  receipt: MountReceipt;
  frameTimeoutMs: number;
  queueTimeoutMs: number;
  signal?: AbortSignal;
  dispose: () => Promise<unknown>;
}): FrameJob => {
  const { receipt, frame, requestId } = options;
  const result = Promise.withResolvers<LoadingOutcome<RenderedFrame>>();
  let terminal = false;
  let running = false;
  let ownership: Ownership | undefined;
  let transport: FrameTransport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: bigint | undefined;
  const queueDeadline = process.hrtime.bigint() + BigInt(Math.ceil(options.queueTimeoutMs * 1e6));
  const rate = createFrameRate(receipt.descriptor.fps);
  if (!rate.ok) throw new Error('A mounted composition must have a validated frame rate.');
  const time = frameToTime(BigInt(frame), rate.value);
  const location = { compositionId: receipt.descriptor.id, frame, timeSeconds: toSeconds(time) };
  const finish = (outcome: LoadingOutcome<RenderedFrame>) => {
    if (terminal) return;
    terminal = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    // A failed/canceled active operation never hands a poisoned realm to another job.
    const located =
      !outcome.ok && 'error' in outcome
        ? {
            ...outcome,
            error: { ...outcome.error, location: { ...outcome.error.location, ...location } },
          }
        : outcome;
    if (!outcome.ok && running) void options.dispose().then(() => result.resolve(located));
    else result.resolve(located);
  };
  const cancel = () => finish(aborted);
  const timeout = async () => {
    if (terminal) return;
    // Freeze publication before probing a responsive coordinator. Never trust a
    // cached inventory after a hung RPC; the bounded probe is failure diagnosis.
    terminal = true;
    options.signal?.removeEventListener('abort', cancel);
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let assets: Awaited<ReturnType<FrameTransport['pendingAssets']>> = [];
    try {
      assets = await Promise.race([
        transport?.pendingAssets(requestId) ?? Promise.resolve([]),
        new Promise<never>((_resolve, reject) => {
          probeTimer = setTimeout(() => reject(new Error('unresponsive')), 100);
        }),
      ]);
    } catch {
      /* An unresponsive realm has no confirmed inventory. */
    } finally {
      clearTimeout(probeTimer);
    }
    const diagnostic: Diagnostic =
      assets.length > 0
        ? {
            code: 'asset.not-ready',
            severity: 'error',
            location,
            message: 'Required assets were not ready before the frame deadline.',
            hint: 'Fix pending asset acquisition, decode or upload, or increase frameTimeoutMs.',
            details: {
              timeoutMs: options.frameTimeoutMs,
              assets: assets.map((asset) => ({
                ...asset,
                source: redactSource(asset.source),
                ...(asset.relatedSources === undefined
                  ? {}
                  : { relatedSources: asset.relatedSources.map(redactSource) }),
              })),
            },
          }
        : {
            code: 'render.frame-timeout',
            severity: 'error',
            location,
            message: 'Frame settlement or capture exceeded the frame deadline.',
            hint: 'Check content, integration and GPU acknowledgements or increase frameTimeoutMs.',
          };
    await options.dispose();
    result.resolve({ ok: false, error: diagnostic });
  };
  timer = setTimeout(cancel, options.queueTimeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted === true) cancel();
  const expired = () => {
    if (terminal) return true;
    if (deadline !== undefined && process.hrtime.bigint() >= deadline) {
      void timeout();
      return true;
    }
    return false;
  };
  return {
    result: result.promise,
    pending: () => !terminal,
    grant: (grant) => {
      if (process.hrtime.bigint() >= queueDeadline) {
        cancel();
        return false;
      }
      if (
        terminal ||
        !running ||
        ownership !== undefined ||
        grant.source !== 'renderer' ||
        grant.requestId !== requestId ||
        grant.instance !== receipt.instance ||
        grant.revision !== receipt.revision ||
        grant.globalFrame !== frame
      )
        return false;
      ownership = grant;
      clearTimeout(timer);
      deadline = process.hrtime.bigint() + BigInt(Math.ceil(options.frameTimeoutMs * 1e6));
      timer = setTimeout(() => {
        void timeout();
      }, options.frameTimeoutMs);
      return true;
    },
    run: (driver) => {
      if (terminal || running) return result.promise;
      running = true;
      transport = driver;
      void (async () => {
        try {
          let settled = await driver.settle(frame, requestId);
          while (!expired()) {
            if (settled.status === 'aborted') {
              finish(aborted);
              return;
            }
            if (settled.status === 'failed') {
              finish({ ok: false, error: settled.diagnostics[0] });
              return;
            }
            const lease = settled.lease;
            if (
              ownership === undefined ||
              lease.source !== ownership.source ||
              lease.instance !== ownership.instance ||
              lease.revision !== ownership.revision ||
              lease.generation !== ownership.generation ||
              lease.globalFrame !== frame ||
              lease.presentationTime.numerator !== time.numerator.toString() ||
              lease.presentationTime.denominator !== time.denominator.toString() ||
              lease.fps.numerator !== receipt.descriptor.fps.numerator ||
              lease.fps.denominator !== receipt.descriptor.fps.denominator
            ) {
              finish(aborted);
              return;
            }
            const validation = await driver.validate(lease);
            if (expired()) return;
            if (validation.status === 'resettle') {
              settled = await driver.resettle(lease);
              continue;
            }
            if (validation.status === 'aborted') {
              finish(aborted);
              return;
            }
            if (validation.status === 'failed') {
              finish({ ok: false, error: validation.diagnostics[0] });
              return;
            }
            const diagnostics = await driver.warnings();
            if (expired()) return;
            const png = await driver.capture(receipt.descriptor.width, receipt.descriptor.height);
            if (expired()) return;
            const completion = await driver.complete(lease);
            if (expired()) return;
            if (completion.status === 'resettle') {
              settled = await driver.resettle(lease);
              continue;
            }
            if (completion.status === 'aborted') {
              finish(aborted);
              return;
            }
            if (completion.status === 'failed') {
              finish({ ok: false, error: completion.diagnostics[0] });
              return;
            }
            finish({
              ok: true,
              value: {
                frame,
                width: receipt.descriptor.width,
                height: receipt.descriptor.height,
                png,
                diagnostics: diagnostics.map((item) => ({
                  ...item,
                  location: { ...item.location, ...location },
                })),
              },
            });
            return;
          }
        } catch {
          if (!expired())
            finish({
              ok: false,
              error: {
                code: 'render.page-error',
                severity: 'error',
                location,
                message: 'The frame transport or page failed.',
                hint: 'Fix the Composition or browser connection and create a new renderer.',
              },
            });
        }
      })();
      return result.promise;
    },
  };
};
