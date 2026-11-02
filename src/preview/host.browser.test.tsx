import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { createFrameRate } from '../core/timeline/time.ts';
import {
  type ElementTree,
  type InspectedElement,
  previewFailureReporter,
} from '../lib/preview-protocol.ts';
import { createCommentBook } from './comment-book.ts';
import { type Review } from './comments-panel.tsx';
import { connectRealm } from './connection.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { createLocaleSetting } from './locale.ts';
import { createReviewController } from './review.ts';
import { PreviewView } from './view.tsx';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Connect to a frame whose document is `body` behind the shell's failure reporter. A blob URL keeps
 * this origin in `location.origin`, which a `srcdoc` frame reports as `null`; it takes no query, so
 * the load is the empty one the reporter falls back to.
 */
const connectTo = (body: string) => {
  const element = document.createElement('iframe');
  document.body.append(element);
  const url = URL.createObjectURL(
    new Blob(
      [`<!doctype html><html><head>${previewFailureReporter}</head><body>${body}</body></html>`],
      {
        type: 'text/html',
      },
    ),
  );
  cleanups.push(() => {
    element.remove();
    URL.revokeObjectURL(url);
  });
  const frame = element.contentWindow;
  if (frame === null) throw new Error('No frame window');
  const connecting = connectRealm({ events: window, frame, origin: window.location.origin }, '');
  element.src = url;
  return connecting;
};

it('reports an entry script that fails to load', async () => {
  await expect(
    connectTo(
      `<script type="module" src="${window.location.origin}/__missing__/entry.js"></script>`,
    ),
  ).rejects.toThrow('Preview realm failed to start');
});

it('reports an entry that throws while it runs', async () => {
  await expect(connectTo('<script type="module">throw new Error("boom")</script>')).rejects.toThrow(
    'Preview realm failed to start',
  );
});

it('waits for an entry that awaits past its frame load before announcing', async () => {
  const connecting = connectTo(
    `<script type="module">await new Promise((done) => addEventListener('load', () => setTimeout(done, 1500)));
parent.postMessage({ type: 'motion-kit-preview-ready', protocolVersion: 2, load: '' }, location.origin);</script>`,
  );
  await expect(connecting).resolves.toHaveProperty('close');
  (await connecting).close();
});

const fakeController = (
  overrides: Partial<PreviewState> = {},
  inspected: readonly InspectedElement[] = [],
  tree: ElementTree | null = null,
) => {
  const calls: string[] = [];
  const state: PreviewState = {
    session: { kind: 'connecting' },
    playback: { kind: 'paused', frame: 0 },
    starting: false,
    playhead: 0,
    shown: undefined,
    spans: [],
    muted: new Set(),
    unplayable: [],
    ...overrides,
  };
  const controller: PreviewController = {
    state: () => state,
    subscribe: () => () => {},
    reload: () => Promise.resolve(),
    choose: () => Promise.resolve(),
    play: () => {
      calls.push('play');
      return Promise.resolve();
    },
    pause: () => calls.push('pause'),
    seek: (frame) => calls.push(`seek ${frame}`),
    step: (delta) => calls.push(`step ${delta}`),
    toggleMute: (src) => calls.push(`toggle ${src}`),
    inspect: (x, y) => {
      calls.push(`inspect ${Math.round(x)},${Math.round(y)}`);
      return Promise.resolve({ ok: true, value: inspected });
    },
    describe: () => {
      calls.push('describe');
      return Promise.resolve({ ok: true, value: tree });
    },
    dispose: () => {},
  };
  return { controller, calls };
};

/** Site storage kept for the test only. */
const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
};

/** The page in English, whatever the browser running the test prefers. */
const english = () => createLocaleSetting(memoryStorage(), ['en']);

/** Comment mode over `controller`, with comments kept for the test only. */
const reviewOf = (controller: PreviewController): Review => {
  const book = createCommentBook(memoryStorage(), '/work/app', 'entry.tsx');
  return {
    controller: createReviewController({ preview: controller, book, props: {} }),
    book,
    site: { projectRoot: '/work/app', realProjectRoot: '/work/app', entry: 'entry.tsx' },
  };
};

it('maps the playback keys anywhere on the page except where a focused control uses them', () => {
  const { controller, calls } = fakeController();
  const root = document.createElement('div');
  const control = (type: string) => {
    const element = document.createElement('input');
    element.type = type;
    return element;
  };
  const [text, checkbox, range] = [control('text'), control('checkbox'), control('range')];
  const select = document.createElement('select');
  document.body.append(root, text, checkbox, range, select);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    for (const element of [root, text, checkbox, range, select]) element.remove();
  });
  act(() =>
    view.render(
      <PreviewView
        locale={english()}
        controller={controller}
        frame={() => {}}
        review={reviewOf(controller)}
        layoutStorage={memoryStorage()}
      />,
    ),
  );
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  press(' ');
  press(' ', { repeat: true });
  press('ArrowRight');
  press('ArrowLeft', { shiftKey: true });
  press(' ', {}, text);
  press('ArrowRight', {}, text);
  press(' ', {}, checkbox);
  press('ArrowRight', {}, checkbox);
  // A select chooses its option with the arrows.
  press(' ', {}, select);
  press('ArrowDown', {}, select);
  press('ArrowRight', {}, select);
  // The scrubber's own arrow step is cancelled, so the frame moves once.
  expect(press('ArrowLeft', {}, range)).toBe(false);
  press(' ', {}, range);
  // History navigation and the IME switch stay with the browser.
  expect(press('ArrowLeft', { altKey: true })).toBe(true);
  press('ArrowRight', { metaKey: true });
  press(' ', { ctrlKey: true });
  expect(calls).toEqual(['play', 'step 1', 'step -10', 'step 1', 'step -1', 'play']);
  expect(root.querySelector('iframe')?.tabIndex).toBe(-1);
});

it('pauses on Space while a play waits for its audio', () => {
  const { controller, calls } = fakeController({ starting: true });
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() =>
    view.render(
      <PreviewView
        locale={english()}
        controller={controller}
        frame={() => {}}
        review={reviewOf(controller)}
        layoutStorage={memoryStorage()}
      />,
    ),
  );
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(calls).toEqual(['pause']);
});

it('packs named Sequence spans that never overlap into one timeline row', () => {
  const fps = createFrameRate({ numerator: 30, denominator: 1 });
  if (!fps.ok) throw new Error('No frame rate');
  const { controller } = fakeController({
    session: {
      kind: 'ready',
      descriptor: {
        id: 'clip',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 60,
      },
      fps: fps.value,
    },
    spans: [
      { path: ['intro'], startFrame: 0, endFrame: 30 },
      { path: ['intro', 'title'], startFrame: 10, endFrame: 20 },
      { path: ['outro'], startFrame: 30, endFrame: 60 },
    ],
  });
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() =>
    view.render(
      <PreviewView
        locale={english()}
        controller={controller}
        frame={() => {}}
        review={reviewOf(controller)}
        layoutStorage={memoryStorage()}
      />,
    ),
  );
  expect(
    [...root.querySelectorAll('[data-slot=timeline-lane]')].map((row) =>
      [...row.querySelectorAll('[data-slot=timeline-span]')].map((bar) => bar.textContent),
    ),
  ).toEqual([['intro', 'outro'], ['intro › title']]);
});

it('shows the audio clips under the named Sequences', () => {
  const { controller } = fakeController({
    session: readySession(60),
    spans: [{ path: ['intro'], startFrame: 0, endFrame: 30 }],
  });
  const { root } = mount(controller);
  expect(
    [...root.querySelectorAll('[data-slot=timeline-lane] > [data-slot]')].map((bar) =>
      bar.getAttribute('data-slot'),
    ),
  ).toEqual(['timeline-span', 'timeline-audio', 'timeline-audio', 'timeline-audio']);
  expect(root.querySelector('[data-slot=timeline-asset]')).toBeNull();
});

it('drags the bottom panel taller and keeps its height for the next load', async () => {
  const storage = memoryStorage();
  const { controller, calls } = fakeController({ session: readySession(60) });
  const first = mount(controller, reviewOf(controller), storage);
  const bottom = (root: HTMLElement) => {
    const panel = root.querySelector('#bottom');
    if (panel === null) throw new Error('No bottom panel');
    return panel.getBoundingClientRect().height;
  };
  const before = bottom(first.root);
  const handle = first.root.querySelector<HTMLElement>(
    '[role=separator][aria-orientation=horizontal]',
  );
  if (handle === null) throw new Error('No bottom resize handle');
  act(() => {
    handle.focus();
    for (let step = 0; step < 3; step += 1)
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  await vi.waitFor(() => expect(bottom(first.root)).toBeGreaterThan(before + 1));
  // The arrows the handle takes do not step the frame as well.
  expect(calls).toEqual([]);
  const taller = bottom(first.root);
  const second = mount(controller, reviewOf(controller), storage);
  expect(bottom(second.root)).toBeCloseTo(taller, 0);
});

it('keeps the controls row the same width while the shown frame lags, and hides the usual lag of playback', () => {
  const fps = createFrameRate({ numerator: 30, denominator: 1 });
  if (!fps.ok) throw new Error('No frame rate');
  const session = {
    kind: 'ready' as const,
    descriptor: {
      id: 'clip',
      width: 320,
      height: 180,
      fps: { numerator: 30, denominator: 1 },
      durationInFrames: 6659,
    },
    fps: fps.value,
  };
  const lagOf = (overrides: Partial<PreviewState>) => {
    const { controller } = fakeController({ session, ...overrides });
    const root = document.createElement('div');
    document.body.append(root);
    const view = createRoot(root);
    cleanups.push(() => {
      act(() => view.unmount());
      root.remove();
    });
    act(() =>
      view.render(
        <PreviewView
          locale={english()}
          controller={controller}
          frame={() => {}}
          review={reviewOf(controller)}
          layoutStorage={memoryStorage()}
        />,
      ),
    );
    const lag = root.querySelector<HTMLElement>('[data-slot=lag]');
    return lag === null ? 'absent' : getComputedStyle(lag).visibility;
  };
  const shown = (frame: number) => ({
    status: 'shown' as const,
    frame,
    sequences: [],
    assets: [],
  });
  const playing = { kind: 'playing' as const, anchorFrame: 0, anchorTime: 0 };
  // The slot is always laid out, so the scrubber never resizes as the lag comes and goes.
  expect(lagOf({ playhead: 205, shown: shown(205) })).toBe('hidden');
  expect(lagOf({ playhead: 205, shown: shown(200) })).toBe('visible');
  // A frame or two behind is every tick of playback; only half a second behind is worth showing.
  expect(lagOf({ playback: playing, playhead: 205, shown: shown(203) })).toBe('hidden');
  expect(lagOf({ playback: playing, playhead: 205, shown: shown(180) })).toBe('visible');
});

it('highlights only the spans the shown frame is inside, not every mounted one', () => {
  const fps = createFrameRate({ numerator: 30, denominator: 1 });
  if (!fps.ok) throw new Error('No frame rate');
  const spans = [
    { path: ['intro'], startFrame: 0, endFrame: 30 },
    { path: ['outro'], startFrame: 30, endFrame: 60 },
  ];
  const { controller } = fakeController({
    session: {
      kind: 'ready',
      descriptor: {
        id: 'clip',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 60,
      },
      fps: fps.value,
    },
    spans,
    // A named Sequence reports itself while its parent is mounted, active or not.
    shown: { status: 'shown', frame: 45, sequences: spans, assets: [] },
  });
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() =>
    view.render(
      <PreviewView
        locale={english()}
        controller={controller}
        frame={() => {}}
        review={reviewOf(controller)}
        layoutStorage={memoryStorage()}
      />,
    ),
  );
  expect(
    [...root.querySelectorAll('[data-slot=timeline-span][data-active]')].map(
      (bar) => bar.textContent,
    ),
  ).toEqual(['outro']);
});

const readySession = (durationInFrames: number) => {
  const fps = createFrameRate({ numerator: 30, denominator: 1 });
  if (!fps.ok) throw new Error('No frame rate');
  return {
    kind: 'ready' as const,
    descriptor: {
      id: 'clip',
      width: 320,
      height: 180,
      fps: { numerator: 30, denominator: 1 },
      durationInFrames,
      audio: [
        { src: 'voice/a.mp3', startInFrames: 0, endInFrames: 30 },
        { src: 'voice/a.mp3', startInFrames: 30, endInFrames: 60 },
        { src: 'bgm.mp3' },
      ],
    },
    fps: fps.value,
  };
};

const mount = (
  controller: PreviewController,
  review = reviewOf(controller),
  layoutStorage = memoryStorage(),
  locale = english(),
) => {
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() =>
    view.render(
      <PreviewView
        locale={locale}
        controller={controller}
        frame={() => {}}
        review={review}
        layoutStorage={layoutStorage}
      />,
    ),
  );
  const tab = (name: string) => {
    const element = [...root.querySelectorAll<HTMLElement>('[role=tab]')].find((item) =>
      item.textContent.startsWith(name),
    );
    if (element === undefined) throw new Error(`No ${name} tab`);
    return element;
  };
  const panelButtons = () => [...root.querySelectorAll<HTMLElement>('[role=tabpanel] button')];
  return { root, tab, panelButtons, review };
};

it('hoists its stylesheet into <head>, so the page text and accessibility tree stay free of CSS', () => {
  const { controller } = fakeController({ session: readySession(60) });
  const { root } = mount(controller);
  expect(document.head.querySelector('style[data-href="motion-kit-preview"]')).not.toBeNull();
  expect(root.querySelector('style')).toBeNull();
  expect(root.textContent).not.toContain('tailwindcss');
});

it('drags the side panel narrower and keeps the width for the next load', async () => {
  const storage = memoryStorage();
  const { controller, calls } = fakeController({ session: readySession(60) });
  const first = mount(controller, reviewOf(controller), storage);
  const side = (root: HTMLElement) => {
    const aside = root.querySelector('aside');
    if (aside === null) throw new Error('No side panel');
    return aside.getBoundingClientRect().width;
  };
  const before = side(first.root);
  const handle = first.root.querySelector<HTMLElement>('[role=separator]');
  if (handle === null) throw new Error('No resize handle');
  // The handle moves right by the keyboard the way a drag moves it, which narrows the side panel;
  // the test page is too narrow to widen it past the stage's minimum.
  act(() => {
    handle.focus();
    for (let step = 0; step < 3; step += 1)
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await vi.waitFor(() => expect(side(first.root)).toBeLessThan(before - 1));
  // The arrows the handle takes do not step the frame as well; Space still plays.
  expect(calls).toEqual([]);
  act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  expect(calls).toEqual(['play']);
  const narrowed = side(first.root);
  const second = mount(controller, reviewOf(controller), storage);
  expect(side(second.root)).toBeCloseTo(narrowed, 0);
});

it('lists each audio source once in the side panel, and its toggle mutes that source', () => {
  const { controller, calls } = fakeController({
    session: readySession(60),
    muted: new Set(['bgm.mp3']),
  });
  const { tab, panelButtons } = mount(controller);
  act(() => tab('Assets').click());
  expect(panelButtons().map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
    'Mute voice/a.mp3',
    'Unmute bgm.mp3',
  ]);
  act(() => panelButtons()[1]?.click());
  expect(calls).toEqual(['toggle bgm.mp3']);
});

it('seeks to the start of a named Sequence chosen in the side panel', () => {
  const { controller, calls } = fakeController({
    session: readySession(60),
    spans: [
      { path: ['intro'], startFrame: 0, endFrame: 30 },
      { path: ['outro'], startFrame: 30, endFrame: 60 },
    ],
  });
  const { tab, panelButtons } = mount(controller);
  act(() => tab('Sequences').click());
  act(() =>
    panelButtons()
      .find((item) => item.textContent.startsWith('outro'))
      ?.click(),
  );
  expect(calls).toEqual(['seek 30']);
});

it('leaves the arrow keys to a focused side panel tab', () => {
  const { controller, calls } = fakeController({ session: readySession(60) });
  const { tab } = mount(controller);
  const composition = tab('Info');
  act(() => composition.focus());
  act(() => {
    composition.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
  });
  expect(calls).toEqual([]);
});

it('comments on the element clicked in comment mode and copies the review as Markdown', async () => {
  const title: InspectedElement = {
    selector: 'h1.title',
    text: 'Hello',
    source: '/work/app/src/title.tsx:3:7',
    box: { x: 20, y: 30, width: 100, height: 40 },
  };
  const { controller, calls } = fakeController({ session: readySession(60), playhead: 12 }, [
    title,
  ]);
  const { root, tab, review } = mount(controller);
  const press = (key: string, target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  act(() => void press('c'));
  expect(calls).toEqual(['pause']);
  expect(review.controller.state().picking).toBe(true);
  const layer = root.querySelector<HTMLElement>('[data-slot=comment-layer]');
  if (layer === null) throw new Error('No comment layer');
  // The layer is the Composition (320×180) scaled into the stage; a click maps back to design pixels.
  const box = layer.getBoundingClientRect();
  // A mouse event keeps whole client pixels, so a point is the whole pixel nearest the design
  // point it aims at, and the expected design point is mapped back from that pixel.
  const aim = (x: number, y: number) => {
    const clientX = Math.round(box.left + (x * box.width) / 320);
    const clientY = Math.round(box.top + (y * box.height) / 180);
    const design = [
      Math.round(((clientX - box.left) * 320) / box.width),
      Math.round(((clientY - box.top) * 180) / box.height),
    ].join(', ');
    return { event: { clientX, clientY, bubbles: true }, design };
  };
  const first = aim(80, 90);
  const at = first.event;
  const point = `inspect ${first.design.replace(' ', '')}`;
  await act(async () => {
    layer.dispatchEvent(new PointerEvent('pointermove', at));
    layer.dispatchEvent(new MouseEvent('click', at));
    await Promise.resolve();
  });
  expect(calls.slice(1)).toEqual([point, point, 'pause']);
  expect(tab('Comments').getAttribute('aria-selected')).toBe('true');
  const field = root.querySelector<HTMLTextAreaElement>('textarea[aria-label=Comment]');
  if (field === null) throw new Error('No comment field');
  expect(document.activeElement).toBe(field);
  // Typing a space in the comment does not toggle playback.
  act(() => void press(' ', field));
  expect(calls).not.toContain('play');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      field,
      'Bigger title',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Another tab drops the field, not the text; picking again moves the draft to the new target,
  // brings the Comments tab back and keeps what was typed.
  act(() => tab('Sequences').click());
  act(() => void press('c'));
  const second = aim(160, 90);
  await act(async () => {
    layer.dispatchEvent(new MouseEvent('click', second.event));
    await Promise.resolve();
  });
  expect(tab('Comments').getAttribute('aria-selected')).toBe('true');
  const kept = root.querySelector<HTMLTextAreaElement>('textarea[aria-label=Comment]');
  expect(kept?.value).toBe('Bigger title');
  expect(document.activeElement).toBe(kept);
  act(() => {
    kept?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect([...root.querySelectorAll('[data-slot=comment]')].map((item) => item.textContent)).toEqual(
    [expect.stringContaining('h1.title · src/title.tsx:3:7Bigger title')],
  );
  expect(root.querySelectorAll('[data-slot=timeline-comment]')).toHaveLength(1);
  const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  cleanups.push(() => written.mockRestore());
  const copy = [...root.querySelectorAll('button')].find((button) =>
    button.textContent.includes('Copy Markdown'),
  );
  await act(async () => {
    copy?.click();
    await Promise.resolve();
  });
  expect(written.mock.calls[0]?.[0]).toContain(
    [
      '## 1. 00:00.40 (frame 12)',
      '',
      `- Element: \`h1.title\` "Hello" from \`src/title.tsx:3:7\`, box (20, 30) 100×40, clicked at (${second.design})`,
      '',
      '> Bigger title',
    ].join('\n'),
  );
  expect(root.textContent).toContain('Copied');
});

it('moves the highlight to the element beneath with the wheel in comment mode and comments on it', async () => {
  const title: InspectedElement = {
    selector: 'h1.title',
    text: 'Hello',
    source: null,
    box: { x: 20, y: 30, width: 100, height: 40 },
  };
  const photo: InspectedElement = {
    selector: 'img.photo',
    text: '',
    source: null,
    box: { x: 0, y: 0, width: 320, height: 180 },
  };
  const { controller } = fakeController({ session: readySession(60) }, [title, photo]);
  const { root, review } = mount(controller);
  act(() => review.controller.togglePicking());
  const layer = root.querySelector<HTMLElement>('[data-slot=comment-layer]');
  if (layer === null) throw new Error('No comment layer');
  const at = {
    clientX: layer.getBoundingClientRect().left + 10,
    clientY: layer.getBoundingClientRect().top + 10,
    bubbles: true,
  };
  await act(async () => {
    layer.dispatchEvent(new PointerEvent('pointermove', at));
    await Promise.resolve();
  });
  const label = () => root.querySelector('[data-slot=comment-target]')?.textContent;
  expect(label()).toBe('h1.title1/2');
  const turn = (deltaY: number) =>
    act(
      () => void layer.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY, cancelable: true })),
    );
  turn(100);
  expect(label()).toBe('img.photo2/2');
  // A wheel turn picks among the elements here; the page beneath does not scroll.
  const wheel = new WheelEvent('wheel', { ...at, deltaY: 100, cancelable: true });
  act(() => void layer.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true);
  expect(label()).toBe('img.photo2/2');
  await act(async () => {
    layer.dispatchEvent(new MouseEvent('click', at));
    await Promise.resolve();
  });
  expect(review.controller.state().draft?.place).toMatchObject({ kind: 'element', element: photo });
});

it('lists the fonts and images of the shown frame only, with their status', () => {
  const { controller } = fakeController({
    session: readySession(60),
    shown: {
      status: 'shown',
      frame: 45,
      sequences: [],
      assets: [
        { kind: 'font', source: '/inter.woff2', status: 'ready' },
        { kind: 'image', source: '/photo.png', status: 'failed' },
        { kind: 'image', source: '/next.png', status: 'pending' },
      ],
    },
  });
  const { root, tab } = mount(controller);
  expect(tab('Info').textContent).toBe('Info');
  expect(root.textContent).toContain('Fonts and images on this frame3');
  act(() => tab('Assets').click());
  expect(
    [...root.querySelectorAll<HTMLElement>('[data-slot=asset]')].map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining('inter.woff2'),
    expect.stringMatching(/photo\.png.*failed/),
    expect.stringMatching(/next\.png.*loading/),
  ]);
});

it('lists no font or image while no frame is shown', () => {
  const { controller } = fakeController({ session: readySession(60) });
  const { root, tab } = mount(controller);
  act(() => tab('Assets').click());
  expect(root.querySelector('[data-slot=asset]')).toBeNull();
  expect(root.textContent).toContain('The shown frame registers no font or image');
});

const tree: ElementTree = {
  nodes: [
    {
      selector: 'div.scene',
      text: 'Hello world',
      source: '/work/app/src/scene.tsx:4:5',
      box: { x: 0, y: 0, width: 320, height: 180 },
      visible: true,
      children: [
        {
          selector: 'h1',
          text: 'Hello',
          source: '/work/app/src/title.tsx:3:7',
          box: { x: 20, y: 30, width: 100, height: 40 },
          visible: true,
          children: [],
        },
        {
          selector: 'p.hidden',
          text: 'world',
          source: null,
          box: { x: 0, y: 0, width: 0, height: 0 },
          visible: false,
          children: [],
        },
      ],
    },
  ],
  truncated: false,
};

it('shows the elements of the paused frame, highlights one on hover and drafts a comment on it', async () => {
  const { controller, calls } = fakeController(
    {
      session: readySession(60),
      playhead: 12,
      shown: { status: 'shown', frame: 12, sequences: [], assets: [] },
    },
    [],
    tree,
  );
  const { root, tab, review } = mount(controller);
  expect(calls).toEqual([]);
  await act(async () => {
    tab('Elements').click();
    await Promise.resolve();
  });
  expect(calls).toEqual(['describe']);
  const rows = () => [...root.querySelectorAll<HTMLElement>('[data-slot=element]')];
  expect(rows().map((row) => [row.textContent, row.hasAttribute('data-hidden')])).toEqual([
    [expect.stringMatching(/^div\.scene.*scene\.tsx:4$/), false],
    // Only an element without children shows its text.
    [expect.stringMatching(/^h1.*Hello.*title\.tsx:3$/), false],
    [expect.stringMatching(/^p\.hidden.*world/), true],
  ]);
  act(() => void rows()[1]?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
  const target = root.querySelector<HTMLElement>('[data-slot=comment-target]');
  expect([target?.style.left, target?.style.top, target?.style.width]).toEqual([
    '20px',
    '30px',
    '100px',
  ]);
  act(() => void rows()[1]?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
  expect(root.querySelector('[data-slot=comment-target]')).toBeNull();
  // Collapsing a node hides its children.
  act(() => rows()[0]?.querySelector<HTMLElement>('button[aria-label=Collapse]')?.click());
  expect(rows()).toHaveLength(1);
  act(() => rows()[0]?.querySelector<HTMLElement>('button[aria-label=Expand]')?.click());
  act(() => rows()[1]?.querySelector<HTMLElement>('button[aria-label="Comment on h1"]')?.click());
  expect(review.controller.state().draft?.place).toEqual({
    kind: 'element',
    element: {
      selector: 'h1',
      text: 'Hello',
      source: '/work/app/src/title.tsx:3:7',
      box: { x: 20, y: 30, width: 100, height: 40 },
    },
  });
  expect(tab('Comments').getAttribute('aria-selected')).toBe('true');
});

it('cuts a long selector so the row keeps its source and comment button', async () => {
  const selector = `div#hero-title${'.text-balance'.repeat(20)}`;
  const { controller } = fakeController(
    { session: readySession(60), shown: { status: 'shown', frame: 0, sequences: [], assets: [] } },
    [],
    {
      nodes: [
        {
          selector,
          text: 'Hello',
          source: '/work/app/src/title.tsx:3:7',
          box: { x: 0, y: 0, width: 10, height: 10 },
          visible: true,
          children: [],
        },
      ],
      truncated: false,
    },
  );
  const { root, tab } = mount(controller);
  await act(async () => {
    tab('Elements').click();
    await Promise.resolve();
  });
  const row = root.querySelector<HTMLElement>('[data-slot=element]');
  const button = row?.querySelector(`button[aria-label="Comment on ${selector}"]`);
  if (row === null || row === undefined || button === null || button === undefined)
    throw new Error('No element row');
  expect(row.scrollWidth).toBe(row.clientWidth);
  expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
    row.getBoundingClientRect().right,
  );
});

it('fits the five side panel tabs with a capped comment count', () => {
  const { controller } = fakeController({ session: readySession(60) });
  const review = reviewOf(controller);
  for (let frame = 0; frame < 120; frame += 1)
    review.book.add({
      compositionId: 'clip',
      props: {},
      time: { kind: 'frame', frame: frame % 60 },
      place: { kind: 'frame' },
      sequences: [],
      body: '',
    });
  const { root, tab } = mount(controller, review);
  expect(tab('Comments').textContent).toBe('Comments 99+');
  const list = root.querySelector<HTMLElement>('[data-slot=tabs-list]');
  if (list === null) throw new Error('No tab list');
  // A wider system font (Linux CI) leaves the labels less room than they need; narrowing the list stands
  // in for it, and the outer tabs must still stay inside.
  list.style.width = '15rem';
  const edge = list.getBoundingClientRect();
  for (const trigger of list.querySelectorAll('[role=tab]')) {
    const box = trigger.getBoundingClientRect();
    expect([box.left >= edge.left, box.right <= edge.right]).toEqual([true, true]);
  }
});

it('asks for no elements while playing', async () => {
  const { controller, calls } = fakeController(
    {
      session: readySession(60),
      playback: { kind: 'playing', anchorFrame: 0, anchorTime: 0 },
      shown: { status: 'shown', frame: 12, sequences: [], assets: [] },
    },
    [],
    tree,
  );
  const { root, tab } = mount(controller);
  await act(async () => {
    tab('Elements').click();
    await Promise.resolve();
  });
  expect(calls).toEqual([]);
  expect(root.querySelector('[role=tabpanel]')?.textContent).toContain('Pause');
});

it('keeps the scrubber the same width from the first frame to the last in either language', () => {
  const scrubberAt = (playhead: number, languages: readonly string[]) => {
    const { controller } = fakeController({ session: readySession(6659), playhead });
    const { root } = mount(
      controller,
      undefined,
      undefined,
      createLocaleSetting(memoryStorage(), languages),
    );
    // Wide enough that the row does not squeeze the frame label.
    root.style.width = '1280px';
    const scrubber = root.querySelector('input[type=range]');
    if (scrubber === null) throw new Error('No scrubber');
    return scrubber.getBoundingClientRect().width;
  };
  for (const languages of [['en'], ['ja']]) {
    const first = scrubberAt(0, languages);
    expect(first).toBeGreaterThan(0);
    expect(scrubberAt(6658, languages)).toBe(first);
  }
});

it('focuses the language select when the settings open and closes them on Escape', async () => {
  const { controller, calls } = fakeController({ session: readySession(60) });
  const { root } = mount(controller);
  const settings = root.querySelector<HTMLElement>('[aria-label=Settings]');
  if (settings === null) throw new Error('No settings button');
  act(() => settings.click());
  const language = await vi.waitFor(() => {
    const select = document.querySelector<HTMLSelectElement>('select[id]');
    if (select === null || document.activeElement !== select) throw new Error('Select not focused');
    return select;
  });
  act(() => {
    language.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await vi.waitFor(() => {
    if (document.querySelector('select[id]') !== null) throw new Error('Settings still open');
  });
  expect(calls).toEqual([]);
});

it('switches the page to Japanese in the settings and keeps the choice for the next load', async () => {
  const storage = memoryStorage();
  const { controller } = fakeController({ session: readySession(60) });
  const first = mount(
    controller,
    reviewOf(controller),
    memoryStorage(),
    createLocaleSetting(storage, ['en-US']),
  );
  const settings = first.root.querySelector<HTMLElement>('[aria-label=Settings]');
  if (settings === null) throw new Error('No settings button');
  act(() => settings.click());
  // The popover is portaled out of the view's root.
  const language = await vi.waitFor(() => {
    const select = document.querySelector<HTMLSelectElement>('select[id]');
    if (select === null) throw new Error('No language select');
    return select;
  });
  expect(document.querySelector(`label[for="${language.id}"]`)?.textContent).toBe('Language');
  expect([...language.options].map((option) => [option.value, option.text, option.lang])).toEqual([
    ['en', 'English', 'en'],
    ['ja', '日本語', 'ja'],
  ]);
  act(() => {
    language.value = 'ja';
    language.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(first.tab('情報').getAttribute('aria-selected')).toBe('true');
  expect(first.root.querySelector('[aria-label=再生]')).not.toBeNull();
  expect(language.value).toBe('ja');
  const second = mount(
    controller,
    reviewOf(controller),
    memoryStorage(),
    createLocaleSetting(storage, ['en-US']),
  );
  expect(second.root.querySelector('[aria-label=設定]')).not.toBeNull();
  expect(second.tab('アセット')).toBeDefined();
});
