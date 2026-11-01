import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import { createFrameRate } from '../core/timeline/time.ts';
import { previewFailureReporter } from '../lib/preview-protocol.ts';
import { connectRealm } from './connection.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
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
parent.postMessage({ type: 'motion-kit-preview-ready', protocolVersion: 1, load: '' }, location.origin);</script>`,
  );
  await expect(connecting).resolves.toHaveProperty('close');
  (await connecting).close();
});

const fakeController = (overrides: Partial<PreviewState> = {}) => {
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
    dispose: () => {},
  };
  return { controller, calls };
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
  document.body.append(root, text, checkbox, range);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    for (const element of [root, text, checkbox, range]) element.remove();
  });
  act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
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
  act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
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
  act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
  expect(
    [...root.querySelectorAll('[data-slot=timeline-lane]')].map((row) =>
      [...row.querySelectorAll('[data-slot=timeline-span]')].map((bar) => bar.textContent),
    ),
  ).toEqual([['intro', 'outro'], ['intro › title']]);
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
    act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
    const lag = root.querySelector<HTMLElement>('[data-slot=lag]');
    return lag === null ? 'absent' : getComputedStyle(lag).visibility;
  };
  const shown = (frame: number) => ({ status: 'shown' as const, frame, sequences: [] });
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
    shown: { status: 'shown', frame: 45, sequences: spans },
  });
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
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

const mount = (controller: PreviewController) => {
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  act(() => view.render(<PreviewView controller={controller} frame={() => {}} />));
  const tab = (name: string) => {
    const element = [...root.querySelectorAll<HTMLElement>('[role=tab]')].find((item) =>
      item.textContent.startsWith(name),
    );
    if (element === undefined) throw new Error(`No ${name} tab`);
    return element;
  };
  const panelButtons = () => [...root.querySelectorAll<HTMLElement>('[role=tabpanel] button')];
  return { root, tab, panelButtons };
};

it('hoists its stylesheet into <head>, so the page text and accessibility tree stay free of CSS', () => {
  const { controller } = fakeController({ session: readySession(60) });
  const { root } = mount(controller);
  expect(document.head.querySelector('style[data-href="motion-kit-preview"]')).not.toBeNull();
  expect(root.querySelector('style')).toBeNull();
  expect(root.textContent).not.toContain('tailwindcss');
});

it('lists each audio source once in the side panel, and its toggle mutes that source', () => {
  const { controller, calls } = fakeController({
    session: readySession(60),
    muted: new Set(['bgm.mp3']),
  });
  const { tab, panelButtons } = mount(controller);
  act(() => tab('Audio').click());
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
  const composition = tab('Composition');
  act(() => composition.focus());
  act(() => {
    composition.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
  });
  expect(calls).toEqual([]);
});
