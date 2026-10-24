import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { defineComposition, defineCompositions } from '../composition/registry.ts';
import { bootstrapComposition } from './browser-entry.ts';

const reset = () => {
  window.__motionKit?.dispose();
  delete window.__motionKit;
  document.body.replaceChildren();
};
afterEach(reset);
it('handshakes, preserves page-local schemas, prepares a fixed root without rendering scene content', async () => {
  const container = document.createElement('div');
  container.id = 'motion-kit-root';
  document.body.append(container);
  let renders = 0;
  let parses = 0;
  let event: unknown;
  window.__motionKitLoadingEvent = (value) => {
    event = value;
    return Promise.resolve();
  };
  const registry = defineCompositions([
    defineComposition({
      id: 'test',
      width: 320,
      height: 180,
      fps: { numerator: 30000, denominator: 1001 },
      durationInFrames: 1,
      component: () => {
        renders++;
        return <div>scene</div>;
      },
      schema: z.object({ text: z.string().default('default') }).transform((props) => {
        parses++;
        return props;
      }),
    }),
  ]);
  bootstrapComposition(registry);
  const api = window.__motionKit;
  if (api === undefined) throw new Error('Missing protocol');
  expect(event).toEqual({ protocolVersion: 1 });
  expect(api.listCompositions()).toMatchObject({
    ok: true,
    value: [{ id: 'test', width: 320, height: 180 }],
  });
  expect(parses).toBe(0);
  expect(
    await api.mount({
      instance: 'instance',
      revision: 'revision',
      props: { text: 'actual' },
      loadingTimeoutMs: 1000,
    }),
  ).toMatchObject({ ok: true, value: { instance: 'instance' } });
  expect(parses).toBe(1);
  expect(renders).toBe(0);
  expect(container.style.width).toBe('320px');
  expect(container.style.height).toBe('180px');
  expect(container.innerHTML).toBe('');
  expect(await api.settleFrame(0, { source: 'preview', requestId: 'wrong-mode' })).toEqual({
    status: 'aborted',
  });
  window.__motionKitOwnership = (ownership) => {
    expect(ownership).toMatchObject({
      source: 'renderer',
      instance: 'instance',
      revision: 'revision',
      globalFrame: 0,
    });
    return Promise.resolve(true);
  };
  const ready = await api.settleFrame(0, { source: 'renderer', requestId: 'frame' });
  expect(ready.status).toBe('ready');
  if (ready.status !== 'ready') throw new Error('Expected ready lease');
  expect(container.textContent).toBe('scene');
  expect(api.validateCapture(ready.lease)).toEqual({ status: 'valid' });
  expect(api.completeCapture(ready.lease)).toEqual({ status: 'accepted' });
  expect(api.completeCapture(ready.lease)).toEqual({ status: 'aborted' });
  expect(parses).toBe(1);
  delete window.__motionKitOwnership;
  expect(api.dispose()).toEqual({ ok: true, value: undefined });
  delete window.__motionKitLoadingEvent;
});

it('preserves registry duration Diagnostic and rejects missing/malformed registries', () => {
  bootstrapComposition(
    defineCompositions([
      defineComposition({
        id: 'invalid',
        width: 1,
        height: 1,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: -1,
        schema: z.object({}),
        component: () => null,
      }),
    ]),
  );
  expect(window.__motionKit?.listCompositions()).toMatchObject({
    ok: false,
    error: { code: 'composition.duration-invalid' },
  });
  reset();
  bootstrapComposition(undefined);
  expect(window.__motionKit?.listCompositions()).toMatchObject({
    ok: false,
    error: { code: 'render.page-error' },
  });
});
