import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { previewReplySchema, type PreviewReply } from '../../lib/preview-protocol.ts';
import { defineComposition, defineCompositions } from '../composition/registry.ts';
import { Sequence } from '../sequence/sequence.tsx';
import { useFrame } from '../timeline/hooks.ts';
import { createLoadingPage } from './browser-entry.ts';
import { answerPreview, servePreviewPort } from './preview-port.ts';

const Scene = ({ label }: { label: string }) => {
  const frame = useFrame();
  return (
    <>
      <p id="frame">
        {label} {frame}
      </p>
      <Sequence name="intro" from={0} duration={1}>
        <span>intro</span>
      </Sequence>
    </>
  );
};
const registry = () =>
  defineCompositions([
    defineComposition({
      id: 'clip',
      width: 320,
      height: 180,
      fps: { numerator: 30, denominator: 1 },
      durationInFrames: 60,
      component: Scene,
      schema: z.object({ label: z.string() }),
    }),
  ]);
const container = () => {
  const root = document.createElement('div');
  root.id = 'motion-kit-root';
  document.body.append(root);
  return root;
};
const pages: ReturnType<typeof createLoadingPage>[] = [];
const previewPage = () => {
  const page = createLoadingPage(registry(), 'preview');
  pages.push(page);
  return page;
};
afterEach(() => {
  for (const page of pages.splice(0)) page.dispose();
  document.body.replaceChildren();
});

it('lists, mounts and shows committed frames with the named Sequences they render', async () => {
  const root = container();
  const page = previewPage();
  expect(await answerPreview(page, { type: 'list', id: 1 })).toMatchObject({
    type: 'listed',
    id: 1,
    result: { ok: true, value: [{ id: 'clip', durationInFrames: 60 }] },
  });
  expect(
    await answerPreview(page, { type: 'mount', id: 2, props: { label: 'frame' } }),
  ).toMatchObject({
    type: 'mounted',
    id: 2,
    result: { ok: true, value: { descriptor: { id: 'clip' } } },
  });
  expect(root.style.width).toBe('320px');
  expect(await answerPreview(page, { type: 'show', id: 3, frame: 12 })).toEqual({
    type: 'shown',
    id: 3,
    outcome: {
      status: 'shown',
      frame: 12,
      sequences: [{ path: ['intro'], startFrame: 0, endFrame: 30 }],
    },
  });
  // The committed frame stays on screen after its lease completes.
  expect(root.querySelector('#frame')?.textContent).toBe('frame 12');
  expect(await answerPreview(page, { type: 'show', id: 4, frame: 45 })).toMatchObject({
    outcome: { status: 'shown', frame: 45 },
  });
  expect(root.querySelector('#frame')?.textContent).toBe('frame 45');
  expect(root.textContent).not.toContain('intro');
});

it('reports props and range failures as data', async () => {
  container();
  const page = previewPage();
  expect(await answerPreview(page, { type: 'mount', id: 1, props: { label: 3 } })).toMatchObject({
    result: { ok: false, error: { code: 'composition.props-invalid' } },
  });
  const other = previewPage();
  await answerPreview(other, { type: 'mount', id: 2, props: { label: 'x' } });
  expect(await answerPreview(other, { type: 'show', id: 3, frame: 60 })).toMatchObject({
    outcome: { status: 'failed', diagnostics: [{ code: 'render.page-error' }] },
  });
});

it('refuses renderer requests and leases in a preview realm', async () => {
  container();
  const page = previewPage();
  await answerPreview(page, { type: 'mount', id: 1, props: { label: 'x' } });
  expect(await page.settleFrame(0, { source: 'renderer', requestId: 'renderer' })).toEqual({
    status: 'aborted',
  });
  const outcome = await page.settleFrame(0, { source: 'preview', requestId: 'preview' });
  if (outcome.status !== 'ready') throw new Error('Expected a ready frame');
  expect(page.completeCapture({ ...outcome.lease, source: 'renderer' })).toEqual({
    status: 'aborted',
  });
  expect(page.completeCapture(outcome.lease)).toEqual({ status: 'accepted' });
});

const Card = () => (
  <div style={{ position: 'relative', width: 320, height: 180 }}>
    <section data-source="/project/scenes/Card.tsx:4:5">
      <h1
        id="title"
        className="lead big"
        style={{ position: 'absolute', left: 40, top: 20, width: 100, height: 30, margin: 0 }}
      >
        Hello{'   '}world
      </h1>
    </section>
  </div>
);

it('describes the element at a design-pixel point of the shown frame, and nothing outside it', async () => {
  container();
  const page = createLoadingPage(
    defineCompositions([
      defineComposition({
        id: 'card',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 30,
        component: Card,
        schema: z.object({}),
      }),
    ]),
    'preview',
  );
  pages.push(page);
  await answerPreview(page, { type: 'mount', id: 1, props: {} });
  await answerPreview(page, { type: 'show', id: 2, frame: 0 });
  expect(await answerPreview(page, { type: 'inspect', id: 3, x: 50, y: 30 })).toEqual({
    type: 'inspected',
    id: 3,
    result: {
      ok: true,
      value: {
        selector: 'h1#title.lead.big',
        text: 'Hello world',
        source: '/project/scenes/Card.tsx:4:5',
        box: { x: 40, y: 20, width: 100, height: 30 },
      },
    },
  });
  expect(await answerPreview(page, { type: 'inspect', id: 4, x: 300, y: 170 })).toMatchObject({
    result: { ok: true, value: { selector: 'div', source: null } },
  });
  expect(await answerPreview(page, { type: 'inspect', id: 5, x: 400, y: 10 })).toEqual({
    type: 'inspected',
    id: 5,
    result: { ok: true, value: null },
  });
});

const nextReply = (port: MessagePort) =>
  new Promise<PreviewReply>((resolve) => {
    port.addEventListener('message', (event) => resolve(previewReplySchema.parse(event.data)), {
      once: true,
    });
    port.start();
  });
const connect = (events: EventTarget, init: MessageEventInit) => {
  const channel = new MessageChannel();
  events.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'motion-kit-preview-connect', protocolVersion: 1 },
      origin: window.location.origin,
      source: window,
      ports: [channel.port2],
      ...init,
    }),
  );
  return channel.port1;
};

it('announces itself and serves only the first port its parent transfers at its origin', async () => {
  container();
  const events = new EventTarget();
  const announced = new Promise<unknown>((resolve) => {
    window.addEventListener('message', (event) => resolve(event.data), { once: true });
  });
  servePreviewPort(previewPage(), {
    events,
    parent: window,
    origin: window.location.origin,
    load: '3',
  });
  expect(await announced).toEqual({
    type: 'motion-kit-preview-ready',
    protocolVersion: 1,
    load: '3',
  });

  const replies: unknown[] = [];
  const watch = (port: MessagePort) => {
    port.addEventListener('message', (event) => replies.push(event.data));
    port.start();
    port.postMessage({ type: 'list', id: 0 });
  };
  watch(connect(events, { origin: 'http://example.com' }));
  watch(connect(events, { source: new MessageChannel().port1 }));
  watch(connect(events, { data: { type: 'motion-kit-preview-connect', protocolVersion: 2 } }));
  const accepted = connect(events, {});
  watch(connect(events, {}));
  const reply = nextReply(accepted);
  accepted.postMessage({ type: 'list', id: 7 });
  accepted.postMessage({ type: 'unknown', id: 8 });
  expect(await reply).toMatchObject({ type: 'listed', id: 7, result: { ok: true } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(replies).toEqual([]);
});

it('answers a request whose handling threw, so the host does not wait on it', async () => {
  container();
  const events = new EventTarget();
  const page = previewPage();
  servePreviewPort(
    { ...page, settleFrame: () => Promise.reject(new Error('boom')) },
    { events, parent: window, origin: window.location.origin, load: '' },
  );
  const port = connect(events, {});
  const reply = nextReply(port);
  port.postMessage({ type: 'show', id: 5, frame: 0 });
  expect(await reply).toMatchObject({
    type: 'shown',
    id: 5,
    outcome: {
      status: 'failed',
      diagnostics: [
        { code: 'internal.unexpected', message: 'The preview realm could not answer: boom' },
      ],
    },
  });
});
