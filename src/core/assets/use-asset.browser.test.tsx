import {
  Composition,
  createCompositionRuntime,
  defineComposition,
  defineCompositions,
  useAsset,
  type Result,
} from 'motion-kit';
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
});
