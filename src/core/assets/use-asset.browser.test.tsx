import {
  Composition,
  createCompositionRuntime,
  defineComposition,
  defineCompositions,
  useAsset,
  useFrame,
  type Result,
} from '@kimuson/motion-kit';
import { Suspense, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('useAsset suspense', () => {
  it('registers the font and image before the suspended subtree commits', async () => {
    const gate = Promise.withResolvers<HTMLImageElement>();
    let committed = 0;
    const Scene = () => (
      <Suspense fallback={<p>fallback</p>}>
        <Loaded />
      </Suspense>
    );
    const Loaded = () => {
      useAsset({ kind: 'image', id: 'hero', source: '/hero.png', sceneId: 'intro' });
      useLayoutEffect(() => {
        committed += 1;
      });
      return <p>ready</p>;
    };
    const definition = unwrap(
      await unwrap(
        defineCompositions([
          defineComposition({
            id: 'assets',
            component: Scene,
            schema: z.object({}),
            width: 64,
            height: 64,
            fps: { numerator: 30, denominator: 1 },
            durationInFrames: 2,
          }),
        ]),
      ).mount({ revision: 'r1' }),
    );
    const options = {
      definition,
      compositionRealm: 'page',
      instance: 'browser',
      assetLoader: () => gate.promise,
    };
    const runtime = createCompositionRuntime(options);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(<Composition definition={definition} compositionRuntime={runtime} />),
      );
      const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'frame' });
      await expect.poll(() => container.textContent, { timeout: 2000 }).toBe('fallback');
      expect(committed).toBe(0);
      expect(runtime.pendingAssets('frame')).toEqual([
        expect.objectContaining({ id: 'hero', kind: 'image', phase: 'decode' }),
      ]);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);
      gate.resolve(new Image());
      await expect(pending).resolves.toMatchObject({ status: 'ready' });
      await expect.poll(() => container.textContent, { timeout: 2000 }).toBe('ready');
      expect(committed).toBe(1);
    } finally {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    }
  });

  it('publishes every failed registration from the error boundary', async () => {
    const gates = new Map<string, PromiseWithResolvers<HTMLImageElement>>();
    const Fail = ({ id, source }: { id: string; source: string }) => {
      useAsset({ kind: 'image', id, source });
      return <p>{id}</p>;
    };
    const Scene = () => (
      <>
        <Fail id="fail-a" source="http://127.0.0.1:9/fail-a.png" />
        <Fail id="fail-b" source="/fail-b.png" />
      </>
    );
    const definition = unwrap(
      await unwrap(
        defineCompositions([
          defineComposition({
            id: 'assets',
            component: Scene,
            schema: z.object({}),
            width: 64,
            height: 64,
            fps: { numerator: 30, denominator: 1 },
            durationInFrames: 2,
          }),
        ]),
      ).mount({ revision: 'r1' }),
    );
    const options = {
      definition,
      compositionRealm: 'page',
      instance: 'browser',
      assetLoader: (descriptor: { id: string }) => {
        const gate = Promise.withResolvers<HTMLImageElement>();
        gates.set(descriptor.id, gate);
        return gate.promise;
      },
    };
    const runtime = createCompositionRuntime(options);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(<Composition definition={definition} compositionRuntime={runtime} />),
      );
      const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'frame' });
      await expect.poll(() => gates.size, { timeout: 2000 }).toBe(2);
      gates.get('fail-a')?.reject(new Error('missing a'));
      gates.get('fail-b')?.reject(new Error('missing b'));
      const settled = await pending;
      expect(settled.status).toBe('failed');
      if (settled.status !== 'failed') throw new Error('expected failure');
      expect(settled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'asset.load-failed',
        'asset.load-failed',
      ]);
      expect(settled.diagnostics.map((diagnostic) => diagnostic.details?.['assets'])).toEqual([
        [expect.objectContaining({ source: 'http://127.0.0.1:9/fail-a.png', phase: 'decode' })],
        [expect.objectContaining({ source: '/fail-b.png', phase: 'decode' })],
      ]);
    } finally {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    }
  });

  it('keeps the assets a fallback hides registered, so a later frame does not load them again', async () => {
    const loads: string[] = [];
    const gates = new Map<string, PromiseWithResolvers<HTMLImageElement>>();
    const Picture = ({ id }: { id: string }) => {
      useAsset({ kind: 'image', id, source: `/${id}.png` });
      return <p>{id}</p>;
    };
    const Scene = () => (
      <Suspense fallback={<p>fallback</p>}>
        <Picture id="shown" />
        {useFrame() >= 1 ? <Picture id="next" /> : null}
      </Suspense>
    );
    const definition = unwrap(
      await unwrap(
        defineCompositions([
          defineComposition({
            id: 'assets',
            component: Scene,
            schema: z.object({}),
            width: 64,
            height: 64,
            fps: { numerator: 30, denominator: 1 },
            durationInFrames: 3,
          }),
        ]),
      ).mount({ revision: 'r1' }),
    );
    const options = {
      definition,
      compositionRealm: 'page',
      instance: 'browser',
      assetLoader: (descriptor: { id: string }) => {
        loads.push(descriptor.id);
        // A load of an asset already loaded once settles at once, so the frame that asks for it
        // again still settles.
        if (gates.has(descriptor.id)) return Promise.resolve(new Image());
        const gate = Promise.withResolvers<HTMLImageElement>();
        gates.set(descriptor.id, gate);
        return gate.promise;
      },
    };
    const runtime = createCompositionRuntime(options);
    const settle = async (frame: number) => {
      const settled = await runtime.settleFrame(frame, {
        source: 'renderer',
        requestId: String(frame),
      });
      if (settled.status !== 'ready') throw new Error('expected a ready frame');
      runtime.completeCapture(settled.lease);
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(<Composition definition={definition} compositionRuntime={runtime} />),
      );
      const first = settle(0);
      await expect.poll(() => gates.has('shown'), { timeout: 2000 }).toBe(true);
      gates.get('shown')?.resolve(new Image());
      await first;
      await expect.poll(() => container.textContent, { timeout: 2000 }).toBe('shown');
      // The picture of the next frame suspends, and the fallback hides the one already shown.
      const second = settle(1);
      await expect.poll(() => container.textContent, { timeout: 2000 }).toBe('shownfallback');
      gates.get('next')?.resolve(new Image());
      await second;
      await expect.poll(() => container.textContent, { timeout: 2000 }).toBe('shownnext');
      await settle(2);
      expect(loads).toEqual(['shown', 'next']);
    } finally {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    }
  });
});
