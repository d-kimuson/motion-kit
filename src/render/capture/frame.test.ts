import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAssetRegistry } from '../../core/assets/registry.ts';
import { type CaptureLease, type Ownership } from '../../lib/frame-protocol.ts';
import { createFrameJob, pngCapture } from './frame.ts';
import { type FrameTransport } from './transport.ts';

const lease: CaptureLease = {
  instance: 'instance',
  revision: 'revision',
  source: 'renderer',
  generation: 1,
  globalFrame: 2,
  fps: { numerator: 30, denominator: 1 },
  presentationTime: { numerator: '1', denominator: '15' },
  resourceRevision: 0,
  resourceVersions: [],
};
const ownership: Ownership = { ...lease, source: 'renderer', requestId: 'request' };
const make = (frameTimeoutMs = 100, queueTimeoutMs = 1000) => {
  const controller = new AbortController();
  const dispose = vi.fn(async () => {});
  const job = createFrameJob({
    requestId: 'request',
    frame: 2,
    format: pngCapture,
    receipt: {
      instance: 'instance',
      revision: 'revision',
      descriptor: {
        id: 'test',
        width: 32,
        height: 24,
        fps: lease.fps,
        durationInFrames: 10,
      },
    },
    frameTimeoutMs,
    queueTimeoutMs,
    signal: controller.signal,
    dispose,
  });
  const driver: FrameTransport = {
    settle: vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return Promise.resolve({ status: 'ready', lease });
    }),
    validate: vi.fn<FrameTransport['validate']>().mockResolvedValue({ status: 'valid' }),
    complete: vi.fn<FrameTransport['complete']>().mockResolvedValue({ status: 'accepted' }),
    resettle: vi.fn<FrameTransport['resettle']>().mockResolvedValue({ status: 'ready', lease }),
    capture: vi.fn<FrameTransport['capture']>().mockResolvedValue(Buffer.from('frame')),
    pendingAssets: vi.fn<FrameTransport['pendingAssets']>().mockResolvedValue([]),
    warnings: vi.fn<FrameTransport['warnings']>().mockResolvedValue([]),
  };
  return { job, driver, dispose, controller };
};
afterEach(() => vi.useRealTimers());
describe('host frame lease', () => {
  it('awaits readiness and validates both sides of dimensioned capture', async () => {
    const { job, driver } = make();
    const ready = Promise.withResolvers<void>();
    driver.settle = vi.fn<FrameTransport['settle']>(async () => {
      job.grant(ownership);
      await ready.promise;
      return { status: 'ready', lease };
    });
    const result = job.run(driver);
    await Promise.resolve();
    expect(driver.capture).not.toHaveBeenCalled();
    ready.resolve();
    expect(await result).toMatchObject({ ok: true, value: { frame: 2 } });
    expect(driver.capture).toHaveBeenCalledWith(32, 24, { type: 'png' });
    expect(driver.validate).toHaveBeenCalledOnce();
    expect(driver.complete).toHaveBeenCalledOnce();
    expect(vi.mocked(driver.validate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(driver.capture).mock.invocationCallOrder[0] ?? 0,
    );
    expect(vi.mocked(driver.complete).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(driver.capture).mock.invocationCallOrder[0] ?? 0,
    );
  });
  it('does not charge queue residence to the frame budget', async () => {
    vi.useFakeTimers();
    const { job, driver } = make();
    await vi.advanceTimersByTimeAsync(500);
    expect(job.pending()).toBe(true);
    expect(await job.run(driver)).toMatchObject({ ok: true });
  });
  it('aborts a queued request without page work or a diagnostic', async () => {
    vi.useFakeTimers();
    const { job, driver, dispose } = make();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await job.run(driver)).toEqual({ ok: false, aborted: true });
    expect(driver.settle).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });
  it('includes a hung screenshot in the original deadline and suppresses late bytes', async () => {
    vi.useFakeTimers();
    const { job, driver, dispose } = make();
    const screenshot = Promise.withResolvers<Buffer>();
    driver.capture = vi.fn(() => screenshot.promise);
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ ok: false, error: [{ code: 'render.frame-timeout' }] });
    screenshot.resolve(Buffer.from('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.complete).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('re-settles changed versions without replacing generation or resetting the deadline', async () => {
    vi.useFakeTimers();
    const { job, driver } = make();
    driver.complete = vi.fn<FrameTransport['complete']>().mockResolvedValue({ status: 'resettle' });
    driver.resettle = vi.fn<FrameTransport['resettle']>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { status: 'ready', lease };
    });
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ ok: false, error: [{ code: 'render.frame-timeout' }] });
    expect(driver.resettle).toHaveBeenCalledWith(lease);
  });
  it('discards changed-version pixels then publishes only accepted replacement bytes', async () => {
    const { job, driver } = make();
    driver.complete = vi
      .fn()
      .mockResolvedValueOnce({ status: 'resettle' })
      .mockResolvedValue({ status: 'accepted' });
    driver.capture = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from('stale'))
      .mockResolvedValue(Buffer.from('current'));
    const result = await job.run(driver);
    expect(result).toMatchObject({
      ok: true,
      value: { format: 'png', image: Buffer.from('current') },
    });
    expect(driver.resettle).toHaveBeenCalledOnce();
  });
  it('re-settles changed versions before taking any screenshot', async () => {
    const { job, driver } = make();
    driver.validate = vi
      .fn<FrameTransport['validate']>()
      .mockResolvedValueOnce({ status: 'resettle' })
      .mockResolvedValue({ status: 'valid' });
    expect(await job.run(driver)).toMatchObject({ ok: true });
    expect(driver.resettle).toHaveBeenCalledOnce();
    expect(driver.capture).toHaveBeenCalledOnce();
    expect(vi.mocked(driver.resettle).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(driver.capture).mock.invocationCallOrder[0] ?? 0,
    );
  });
  it('suppresses a generation invalidated during screenshot', async () => {
    const { job, driver, dispose } = make();
    driver.complete = vi.fn<FrameTransport['complete']>().mockResolvedValue({ status: 'aborted' });
    expect(await job.run(driver)).toEqual({ ok: false, aborted: true });
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('aborts an unfinished ownership grant and rejects its late acknowledgement', async () => {
    vi.useFakeTimers();
    const { job, driver, dispose } = make(100, 1000);
    driver.settle = vi.fn<FrameTransport['settle']>(() => new Promise(() => {}));
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ ok: false, aborted: true });
    expect(job.grant(ownership)).toBe(false);
    expect(driver.capture).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('suppresses a stale generation before screenshot', async () => {
    const { job, driver, dispose } = make();
    driver.settle = vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return Promise.resolve({ status: 'ready', lease: { ...lease, generation: 2 } });
    });
    expect(await job.run(driver)).toEqual({ ok: false, aborted: true });
    expect(driver.capture).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('suppresses a canceled generation even when screenshot finishes late', async () => {
    const { job, driver, controller, dispose } = make();
    driver.capture = vi.fn(() => {
      controller.abort();
      return Promise.resolve(Buffer.from('canceled'));
    });
    expect(await job.run(driver)).toEqual({ ok: false, aborted: true });
    expect(driver.complete).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('publishes every asset diagnostic from a failed settlement', async () => {
    const { job, driver } = make();
    const diagnostic = (source: string) => ({
      code: 'asset.load-failed' as const,
      severity: 'error' as const,
      message: 'The required image failed to decode.',
      hint: 'Check the image source and file format.',
      details: { assets: [{ kind: 'image', source, phase: 'decode' }] },
    });
    driver.settle = vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return Promise.resolve({
        status: 'failed',
        diagnostics: [diagnostic('/one.png'), diagnostic('/two.png')],
      });
    });
    const result = await job.run(driver);
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) throw new Error('expected diagnostics');
    expect(result.error.map((item) => item.code)).toEqual([
      'asset.load-failed',
      'asset.load-failed',
    ]);
    expect(result.error.map((item) => item.details)).toEqual([
      { assets: [{ kind: 'image', source: '/one.png', phase: 'decode' }] },
      { assets: [{ kind: 'image', source: '/two.png', phase: 'decode' }] },
    ]);
    expect(driver.capture).not.toHaveBeenCalled();
  });
  it('reports current assets at deadline, redacts sources and preserves the configured budget', async () => {
    vi.useFakeTimers();
    const { job, driver } = make();
    driver.settle = vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return new Promise(() => {});
    });
    driver.pendingAssets = vi.fn<FrameTransport['pendingAssets']>().mockResolvedValue([
      {
        kind: 'image',
        source: 'https://user:pass@example.com/image?token=secret',
        phase: 'decode',
      },
    ]);
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({
      ok: false,
      error: [
        {
          code: 'asset.not-ready',
          details: {
            timeoutMs: 100,
            assets: [{ source: 'https://example.com/image (+1 query parameter, redacted)' }],
          },
        },
      ],
    });
  });
  it('reports the registry source unchanged on the host deadline', async () => {
    vi.useFakeTimers();
    const registry = createAssetRegistry({ load: () => new Promise(() => {}) });
    registry.retain(
      { kind: 'image', id: 'marked', source: '/a.png?token=secret', sceneId: 'intro' },
      'marked',
      { compositionId: 'demo', frame: 2, timeSeconds: 0.1, generation: 1 },
    );
    registry.retain(
      {
        kind: 'image',
        id: 'sentinel',
        source: 'https://cdn.example/%2F%2Fuser%3As3cret%40evil.example%2Fx',
      },
      'sentinel',
      { compositionId: 'demo', frame: 2, timeSeconds: 0.1, generation: 1 },
    );
    const reported = registry.pending().map((asset) => asset.source);
    expect(reported).toEqual(['/a.png (+1 query parameter, redacted)', '[asset source]']);
    const { job, driver } = make();
    driver.settle = vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return new Promise(() => {});
    });
    driver.pendingAssets = vi
      .fn<FrameTransport['pendingAssets']>()
      .mockResolvedValue([...registry.pending()]);
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(100);
    const settled = await result;
    expect(settled.ok).toBe(false);
    if (settled.ok || !('error' in settled)) throw new Error('expected diagnostics');
    const assets = settled.error[0]?.details?.['assets'];
    const readSource = (value: unknown): string | undefined => {
      if (typeof value !== 'object' || value === null || !('source' in value)) return undefined;
      const source = value['source'];
      return typeof source === 'string' ? source : undefined;
    };
    const sources = Array.isArray(assets)
      ? assets.flatMap((asset) => {
          const source = readSource(asset);
          return source === undefined ? [] : [source];
        })
      : [];
    expect(sources).toEqual(reported);
    expect(sources[0]).toBe(reported[0]);
    expect(sources[1]).toBe(reported[1]);
  });
  it('does not invent an asset inventory for an unresponsive RPC', async () => {
    vi.useFakeTimers();
    const { job, driver } = make();
    driver.settle = vi.fn<FrameTransport['settle']>(() => {
      job.grant(ownership);
      return new Promise(() => {});
    });
    driver.pendingAssets = vi.fn<FrameTransport['pendingAssets']>(() => new Promise(() => {}));
    const result = job.run(driver);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({ ok: false, error: [{ code: 'render.frame-timeout' }] });
  });
});
