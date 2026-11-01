import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  previewReplySchema,
  type ElementNode,
  type PreviewReply,
} from '../../lib/preview-protocol.ts';
import { useAsset } from '../assets/use-asset.ts';
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
      assets: [],
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

const pixel = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>")}`;
const Picture = ({ source }: { source: string }) => {
  const image = useAsset({ kind: 'image', id: 'picture', source });
  return <img alt="" src={image.src} />;
};
const Pictures = () =>
  useFrame() < 30 ? <Picture source={pixel} /> : <Picture source="/missing.png" />;

it('reports the assets a frame registered, a failed one with the failure', async () => {
  container();
  const page = createLoadingPage(
    defineCompositions([
      defineComposition({
        id: 'pictures',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 60,
        component: Pictures,
        schema: z.object({}),
      }),
    ]),
    'preview',
  );
  pages.push(page);
  await answerPreview(page, { type: 'mount', id: 1, props: {} });
  expect(await answerPreview(page, { type: 'show', id: 2, frame: 0 })).toMatchObject({
    outcome: { status: 'shown', assets: [{ kind: 'image', source: pixel, status: 'ready' }] },
  });
  expect(await answerPreview(page, { type: 'show', id: 3, frame: 40 })).toMatchObject({
    outcome: {
      status: 'failed',
      diagnostics: [{ code: 'asset.load-failed' }],
      assets: [{ kind: 'image', source: '/missing.png', status: 'failed' }],
    },
  });
});

// A clip drawn as one picture per frame, like an image sequence, in a boundary of its own.
const framePicture = (frame: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${frame + 1}' height='1'/>`)}`;
// Frame 2 of the film is missing its picture.
const Film = () => {
  const frame = useFrame();
  return (
    <>
      <p id="frame">{frame}</p>
      <Suspense fallback={null}>
        <Picture source={frame === 2 ? '/missing.png' : framePicture(frame)} />
      </Suspense>
    </>
  );
};
const filmPage = async () => {
  const root = container();
  const page = createLoadingPage(
    defineCompositions([
      defineComposition({
        id: 'film',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 60,
        component: Film,
        schema: z.object({}),
      }),
    ]),
    'preview',
  );
  pages.push(page);
  await answerPreview(page, { type: 'mount', id: 1, props: {} });
  await answerPreview(page, { type: 'show', id: 2, frame: 1 });
  return { root, page };
};
/** Whether the frame text or the picture left the screen at any point while `work` ran. */
const blanksDuring = async (root: HTMLElement, work: () => Promise<unknown>) => {
  let blanked = false;
  const observer = new MutationObserver(() => {
    const picture = root.querySelector('img');
    if (root.querySelector('#frame') === null || picture === null || !picture.checkVisibility())
      blanked = true;
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  await work();
  observer.disconnect();
  return blanked;
};

it('keeps the shown frame on screen while the next one loads its picture', async () => {
  const { root, page } = await filmPage();
  expect(
    await blanksDuring(root, () => answerPreview(page, { type: 'show', id: 3, frame: 4 })),
  ).toBe(false);
  expect(root.querySelector('#frame')?.textContent).toBe('4');
  expect(root.querySelector('img')?.getAttribute('src')).toBe(framePicture(4));
});

it('keeps the shown frame on screen when a newer frame cuts the next one off', async () => {
  const { root, page } = await filmPage();
  let outcomes: PreviewReply[] = [];
  expect(
    await blanksDuring(root, async () => {
      outcomes = await Promise.all([
        answerPreview(page, { type: 'show', id: 3, frame: 4 }),
        answerPreview(page, { type: 'show', id: 4, frame: 5 }),
      ]);
    }),
  ).toBe(false);
  expect(outcomes).toMatchObject([
    { outcome: { status: 'aborted' } },
    { outcome: { status: 'shown', frame: 5 } },
  ]);
  expect(root.querySelector('#frame')?.textContent).toBe('5');
});

it('shows the next frame again after a frame failed to load its picture', async () => {
  const { root, page } = await filmPage();
  expect(await answerPreview(page, { type: 'show', id: 3, frame: 2 })).toMatchObject({
    outcome: { status: 'failed', diagnostics: [{ code: 'asset.load-failed' }] },
  });
  // The failure clears the frame once React commits it, which may be after the reply.
  await vi.waitFor(() => expect(root.querySelector('#frame')).toBeNull());
  expect(await answerPreview(page, { type: 'show', id: 4, frame: 3 })).toMatchObject({
    outcome: { status: 'shown', frame: 3 },
  });
  expect(root.querySelector('#frame')?.textContent).toBe('3');
  expect(root.querySelector('img')?.getAttribute('src')).toBe(framePicture(3));
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
    {/* A later shot faded out over the title: it paints nothing, so a click goes through it. */}
    <div style={{ opacity: 0 }}>
      <p style={{ position: 'absolute', left: 0, top: 0, width: 320, height: 60, margin: 0 }}>
        Next
      </p>
    </div>
    {/* A layout box whose items have not risen yet: it is visible but paints nothing itself. */}
    <div style={{ position: 'absolute', left: 20, top: 10, width: 200, height: 60 }}>
      <span style={{ opacity: 0 }}>Agenda</span>
    </div>
  </div>
);

it('describes the visible element at a design-pixel point of the shown frame, and nothing outside it', async () => {
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

/** A tree as selector, visibility and source, which is what tells its elements apart here. */
const outline = (nodes: readonly ElementNode[]): unknown[] =>
  nodes.map((node) => [node.selector, node.visible, node.source, outline(node.children)]);

it('describes every element of the shown frame as a tree, the invisible ones marked', async () => {
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
  expect(await answerPreview(page, { type: 'describe', id: 1 })).toEqual({
    type: 'described',
    id: 1,
    result: { ok: true, value: { nodes: [], truncated: false } },
  });
  await answerPreview(page, { type: 'mount', id: 2, props: {} });
  await answerPreview(page, { type: 'show', id: 3, frame: 0 });
  const reply = await answerPreview(page, { type: 'describe', id: 4 });
  if (reply.type !== 'described' || !reply.result.ok || reply.result.value === null)
    throw new Error('Expected a tree');
  const tree = reply.result.value;
  expect(tree.truncated).toBe(false);
  expect(outline(tree.nodes)).toEqual([
    [
      'div',
      true,
      null,
      [
        [
          'section',
          true,
          '/project/scenes/Card.tsx:4:5',
          [['h1#title.lead.big', true, '/project/scenes/Card.tsx:4:5', []]],
        ],
        ['div', false, null, [['p', false, null, []]]],
        ['div', true, null, [['span', false, null, []]]],
      ],
    ],
  ]);
  expect(tree.nodes[0]?.children[0]?.children[0]).toMatchObject({
    text: 'Hello world',
    box: { x: 40, y: 20, width: 100, height: 30 },
  });
});

it('leaves out the elements past the size limit', async () => {
  container();
  const Many = () => (
    <div>
      {Array.from({ length: 3000 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
  const page = createLoadingPage(
    defineCompositions([
      defineComposition({
        id: 'many',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 30,
        component: Many,
        schema: z.object({}),
      }),
    ]),
    'preview',
  );
  pages.push(page);
  await answerPreview(page, { type: 'mount', id: 1, props: {} });
  await answerPreview(page, { type: 'show', id: 2, frame: 0 });
  const reply = await answerPreview(page, { type: 'describe', id: 3 });
  if (reply.type !== 'described' || !reply.result.ok || reply.result.value === null)
    throw new Error('Expected a tree');
  expect(reply.result.value.truncated).toBe(true);
  expect(reply.result.value.nodes[0]?.children).toHaveLength(1999);
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
