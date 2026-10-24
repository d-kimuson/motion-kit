import {
  createCompositionRuntime,
  defineComposition,
  defineCompositions,
  type Result,
} from 'motion-kit';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const prepared = async (durationInFrames = 5) =>
  unwrap(
    await unwrap(
      defineCompositions([
        defineComposition({
          id: 'test',
          width: 100,
          height: 100,
          fps: { numerator: 30000, denominator: 1001 },
          durationInFrames,
          schema: z.object({}),
          component: () => null,
        }),
      ]),
    ).mount({ revision: 'r1' }),
  );
const deferred = <T>() => Promise.withResolvers<T>();
const tick = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};

const setup = async () => {
  const definition = await prepared();
  const runtime = createCompositionRuntime({
    definition,
    compositionRealm: 'page',
    instance: 'one',
  });
  return runtime;
};

describe('Composition runtime ownership', () => {
  it('queues generations without invalidating active ownership and rejects stale acknowledgement', async () => {
    const runtime = await setup();
    const first = runtime.settleFrame(0, { source: 'renderer', requestId: 'a' });
    await tick();
    const active = runtime.getSnapshot();
    const second = runtime.settleFrame(1, { source: 'renderer', requestId: 'b' });
    expect(runtime.getSnapshot()).toBe(active);
    expect(runtime.acknowledgeContent('composition-root', 0, '1')).toBe(false);
    expect(runtime.acknowledgeContent('composition-root', 2, '1')).toBe(false);
    expect(runtime.acknowledgeContent('composition-root', 1, '1')).toBe(true);
    const ready = await first;
    if (ready.status !== 'ready') throw new Error('not ready');
    expect(runtime.getSnapshot()?.generation).toBe(1);
    expect(runtime.completeCapture({ ...ready.lease, generation: 2 })).toEqual({
      status: 'aborted',
    });
    expect(runtime.completeCapture(ready.lease)).toEqual({ status: 'accepted' });
    await tick();
    expect(runtime.getSnapshot()?.generation).toBe(2);
    expect(runtime.acknowledgeContent('composition-root', 1, '1')).toBe(false);
    runtime.acknowledgeContent('composition-root', 2, '1');
    expect(await second).toMatchObject({
      status: 'ready',
      lease: {
        generation: 2,
        globalFrame: 1,
        presentationTime: { numerator: '1001', denominator: '30000' },
      },
    });
    runtime.dispose();
  });

  it('re-settles resource changes within the same generation and rejects old or duplicate leases', async () => {
    const runtime = await setup();
    const content = runtime.registerContent('nested', 'v1');
    const first = runtime.settleFrame(2, { source: 'renderer', requestId: 'a' });
    await tick();
    runtime.acknowledgeContent('composition-root', 1, '1');
    content.acknowledge(1, 'v1');
    const ready = await first;
    if (ready.status !== 'ready') throw new Error('not ready');
    content.update('v2');
    expect(runtime.validateCapture(ready.lease)).toEqual({ status: 'resettle' });
    expect(runtime.completeCapture(ready.lease)).toEqual({ status: 'resettle' });
    const settled = runtime.resettle(ready.lease);
    expect(runtime.resettle(ready.lease)).toBe(settled);
    expect(runtime.getSnapshot()?.generation).toBe(1);
    expect(content.acknowledge(1, 'v1')).toBe(false);
    content.acknowledge(1, 'v2');
    const next = await settled;
    if (next.status !== 'ready') throw new Error('not ready');
    expect(next.lease.generation).toBe(1);
    expect(runtime.completeCapture(ready.lease)).toEqual({ status: 'resettle' });
    expect(runtime.completeCapture({ ...next.lease, source: 'preview' })).toEqual({
      status: 'aborted',
    });
    expect(runtime.completeCapture(next.lease)).toEqual({ status: 'accepted' });
    expect(runtime.completeCapture(next.lease)).toEqual({ status: 'aborted' });
    runtime.dispose();
  });

  it('aborts cancellation without publication and waits for old work before granting the queue', async () => {
    const runtime = await setup();
    const work = deferred<Result<undefined>>();
    runtime.registerIntegration({
      id: 'adapter',
      version: 'v1',
      seekability: 'B',
      settle: () => work.promise,
    });
    const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'a' });
    await tick();
    runtime.acknowledgeContent('composition-root', 1, '1');
    await tick();
    const next = runtime.settleFrame(1, { source: 'renderer', requestId: 'b' });
    runtime.cancel('a');
    expect(await pending).toEqual({ status: 'aborted' });
    expect(runtime.getSnapshot()).toBeNull();
    await tick();
    expect(runtime.getSnapshot()).toBeNull();
    work.resolve({ ok: true, value: undefined });
    await tick();
    expect(runtime.getSnapshot()?.generation).toBe(2);
    runtime.acknowledgeContent('composition-root', 2, '1');
    expect(await next).toMatchObject({ status: 'ready' });
    runtime.dispose();
  });

  it('tracks resettlement before reentrant cancellation and holds the queue until work finishes', async () => {
    const runtime = await setup();
    const work = deferred<Result<undefined>>();
    try {
      const first = runtime.settleFrame(0, { source: 'renderer', requestId: 'first' });
      await tick();
      runtime.acknowledgeContent('composition-root', 1, '1');
      const ready = await first;
      if (ready.status !== 'ready') throw new Error('not ready');
      const second = runtime.settleFrame(1, { source: 'renderer', requestId: 'second' });
      runtime.registerIntegration({
        id: 'reentrant',
        version: '1',
        seekability: 'B',
        settle: () => {
          runtime.cancel('first');
          return work.promise;
        },
      });
      expect(await runtime.resettle(ready.lease)).toEqual({ status: 'aborted' });
      await tick();
      expect(runtime.getSnapshot()).toBeNull();
      work.resolve({ ok: true, value: undefined });
      await tick();
      expect(runtime.getSnapshot()?.generation).toBe(2);
      runtime.acknowledgeContent('composition-root', 2, '1');
      expect(await second).toMatchObject({ status: 'ready' });
    } finally {
      work.resolve({ ok: true, value: undefined });
      runtime.dispose();
    }
  });

  it('finishes teardown and reports a throwing integration disposer without retaining listeners', async () => {
    const runtime = await setup();
    const first = vi.fn(() => {
      throw new Error('private disposal details');
    });
    const second = vi.fn();
    const unregister = [first, second].map((dispose, index) =>
      runtime.registerIntegration({
        id: String(index),
        version: '1',
        seekability: 'B',
        settle: () => Promise.resolve({ ok: true, value: undefined }),
        dispose,
      }),
    );
    const content = runtime.registerContent('nested', '1');
    const listener = vi.fn();
    runtime.subscribe(listener);
    const detachRoot = runtime.attachRoot();
    const result = runtime.dispose();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(runtime.dispose()).toEqual(result);
    listener.mockClear();
    for (const detach of unregister) detach();
    content.update('2');
    content.dispose();
    detachRoot(); // Registration handles and listeners must be detached after teardown.
    expect(listener).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot()).toBeNull();
    expect(await runtime.settleFrame(0, { source: 'renderer', requestId: 'late' })).toEqual({
      status: 'aborted',
    });
  });

  it('preview supersedes only preview work and joins behind surviving renderer requests', async () => {
    const runtime = await setup();
    const renderer = runtime.settleFrame(0, { source: 'renderer', requestId: 'r1' });
    const oldPreview = runtime.settleFrame(1, { source: 'preview', requestId: 'p1' });
    const renderer2 = runtime.settleFrame(2, { source: 'renderer', requestId: 'r2' });
    const preview = runtime.settleFrame(3, { source: 'preview', requestId: 'p2' });
    expect(await oldPreview).toEqual({ status: 'aborted' });
    await tick();
    runtime.acknowledgeContent('composition-root', 1, '1');
    const ready = await renderer;
    if (ready.status !== 'ready') throw new Error('not ready');
    runtime.completeCapture(ready.lease);
    await tick();
    expect(runtime.getSnapshot()?.generation).toBe(3);
    runtime.acknowledgeContent('composition-root', 3, '1');
    const ready2 = await renderer2;
    if (ready2.status !== 'ready') throw new Error('not ready');
    runtime.completeCapture(ready2.lease);
    await tick();
    expect(runtime.getSnapshot()?.generation).toBe(4);
    runtime.cancel('p2');
    expect(await preview).toEqual({ status: 'aborted' });
    runtime.dispose();
  });

  it('aborts an already ready lease and active preview supersession without publishing', async () => {
    const runtime = await setup();
    const old = runtime.settleFrame(0, { source: 'preview', requestId: 'old' });
    await tick();
    runtime.acknowledgeContent('composition-root', 1, '1');
    const ready = await old;
    if (ready.status !== 'ready') throw new Error('not ready');
    const next = runtime.settleFrame(2, { source: 'preview', requestId: 'new' });
    expect(runtime.completeCapture(ready.lease)).toEqual({ status: 'aborted' });
    expect(await runtime.resettle(ready.lease)).toEqual({ status: 'aborted' });
    await tick();
    runtime.acknowledgeContent('composition-root', 2, '1');
    expect(await next).toMatchObject({ status: 'ready' });
    runtime.dispose();
  });

  it('drains work discovered by an integration and detaches replaced callbacks', async () => {
    const runtime = await setup();
    let first = true;
    let content: ReturnType<typeof runtime.registerContent> | undefined;
    const adapter = vi.fn(() => {
      if (first) {
        first = false;
        content = runtime.registerContent('discovered', 'v1');
      }
      return Promise.resolve({ ok: true, value: undefined } as const);
    });
    runtime.registerIntegration({
      id: 'adapter',
      version: 'v1',
      seekability: 'B',
      settle: adapter,
    });
    const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'a' });
    await tick();
    runtime.acknowledgeContent('composition-root', 1, '1');
    await tick();
    expect(adapter).toHaveBeenCalledTimes(1);
    if (content === undefined) throw new Error('missing content');
    content.acknowledge(1, 'v1');
    expect(await pending).toMatchObject({ status: 'ready' });
    expect(adapter).toHaveBeenCalledTimes(2);
    content.dispose();
    const replacement = runtime.registerContent('discovered', 'v1');
    expect(content.acknowledge(1, 'v1')).toBe(false);
    expect(replacement.acknowledge(1, 'v1')).toBe(true);
    runtime.dispose();
  });

  it('starts the finite frame budget only at grant and never resets it after readiness or resettle', async () => {
    vi.useFakeTimers();
    try {
      const definition = await prepared();
      const grant = deferred<void>();
      const runtime = createCompositionRuntime({
        definition,
        compositionRealm: 'page',
        instance: 'one',
        frameTimeoutMs: 20,
        queueTimeoutMs: 100,
        acquire: () => grant.promise,
      });
      const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'a' });
      await vi.advanceTimersByTimeAsync(50);
      expect(runtime.getSnapshot()).toBeNull();
      grant.resolve();
      await tick();
      runtime.acknowledgeContent('composition-root', 1, '1');
      const ready = await pending;
      if (ready.status !== 'ready') throw new Error('not ready');
      await vi.advanceTimersByTimeAsync(10);
      const content = runtime.registerContent('late', 'v1');
      const resettled = runtime.resettle(ready.lease);
      content.acknowledge(1, 'v1');
      const current = await resettled;
      if (current.status !== 'ready') throw new Error('not ready');
      await vi.advanceTimersByTimeAsync(9);
      expect(runtime.validateCapture(current.lease)).toEqual({ status: 'valid' });
      await vi.advanceTimersByTimeAsync(1);
      expect(runtime.validateCapture(ready.lease)).toMatchObject({
        status: 'failed',
        diagnostics: [{ code: 'render.frame-timeout' }],
      });
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an expired queued grant and ignores late confirmation', async () => {
    vi.useFakeTimers();
    try {
      const grant = deferred<void>();
      const runtime = createCompositionRuntime({
        definition: await prepared(),
        compositionRealm: 'page',
        instance: 'one',
        acquire: () => grant.promise,
        queueTimeoutMs: 10,
      });
      const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'a' });
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toEqual({ status: 'aborted' });
      grant.resolve();
      await tick();
      expect(runtime.getSnapshot()).toBeNull();
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects zero duration and out-of-range requests before any page mutation', async () => {
    const runtime = createCompositionRuntime({
      definition: await prepared(0),
      compositionRealm: 'page',
      instance: 'zero',
    });
    expect(await runtime.settleFrame(0, { source: 'renderer', requestId: 'a' })).toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'render.page-error' }],
    });
    expect(runtime.getSnapshot()).toBeNull();
    runtime.dispose();
    const normal = await setup();
    for (const frame of [-1, 5, 1.5, Number.NaN])
      expect(
        await normal.settleFrame(frame, { source: 'renderer', requestId: String(frame) }),
      ).toMatchObject({ status: 'failed' });
    normal.dispose();
  });
});
