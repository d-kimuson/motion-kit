import {
  Composition,
  CompositionContent,
  createCompositionRuntime,
  defineComposition,
  defineCompositions,
  useCompositionFrame,
  type ContentRegistration,
  type Result,
} from 'motion-kit';
import { Suspense, use } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const metadata = {
  id: 'test',
  width: 100,
  height: 100,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 10,
};

describe('Composition provider', () => {
  it('renders only validated selected props at owned time without parsing per frame', async () => {
    const parse = vi.fn((props: { title: string }) => props);
    const schema = z.object({ title: z.string().default('Hello') }).transform(parse);
    const unselected = vi.fn(() => <p>unselected</p>);
    const Scene = ({ title }: { title: string }) => (
      <p>
        {title}:{useCompositionFrame().globalFrame}
      </p>
    );
    const registry = unwrap(
      defineCompositions([
        defineComposition({ ...metadata, schema, component: Scene }),
        defineComposition({
          ...metadata,
          id: 'other',
          schema: z.object({}),
          component: unselected,
        }),
      ]),
    );
    const definition = unwrap(
      await registry.mount({ compositionId: 'test', props: { title: 'Selected' }, revision: 'r1' }),
    );
    const runtime = createCompositionRuntime({
      definition,
      instance: 'one',
      compositionRealm: 'iframe',
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(<Composition definition={definition} compositionRuntime={runtime} />),
      );
      expect(container.textContent).toBe('');
      for (const frame of [0, 7, 2, 7, 0]) {
        const result = await runtime.settleFrame(frame, {
          source: 'renderer',
          requestId: `frame-${frame}-${parse.mock.calls.length}-${container.textContent}`,
        });
        if (result.status !== 'ready') throw new Error('not ready');
        expect(container.textContent).toBe(`Selected:${frame}`);
        expect(runtime.completeCapture(result.lease)).toEqual({ status: 'accepted' });
      }
      expect(parse).toHaveBeenCalledTimes(2);
      expect(unselected).not.toHaveBeenCalled();
    } finally {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    }
  });

  it('waits for delayed nested required content rather than a Suspense fallback or root effect', async () => {
    const gate = Promise.withResolvers<string>();
    let registration: ContentRegistration;
    const Content = () => (
      <b>
        {use(gate.promise)}:{useCompositionFrame().globalFrame}
      </b>
    );
    const Scene = () => (
      <Suspense fallback={<i>fallback</i>}>
        <CompositionContent registration={registration}>
          <Content />
        </CompositionContent>
      </Suspense>
    );
    const definition = unwrap(
      await unwrap(
        defineCompositions([
          defineComposition({ ...metadata, schema: z.object({}), component: Scene }),
        ]),
      ).mount({ revision: 'r1' }),
    );
    const runtime = createCompositionRuntime({
      definition,
      instance: 'one',
      compositionRealm: 'iframe',
    });
    registration = runtime.registerContent('required', 'source-v1');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(<Composition definition={definition} compositionRuntime={runtime} />),
      );
      let ready = false;
      const result = runtime.settleFrame(3, { source: 'renderer', requestId: 'frame' });
      void result.then(() => {
        ready = true;
      });
      await vi.waitFor(() => expect(container.textContent).toBe('fallback'));
      expect(ready).toBe(false);
      gate.resolve('content');
      const settled = await result;
      expect(settled.status).toBe('ready');
      expect(container.textContent).toBe('content:3');
    } finally {
      flushSync(() => root.unmount());
      runtime.dispose();
      container.remove();
    }
  });
});
