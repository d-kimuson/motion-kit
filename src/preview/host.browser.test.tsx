import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

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

const fakeController = () => {
  const calls: string[] = [];
  const state: PreviewState = {
    session: { kind: 'connecting' },
    playback: { kind: 'paused', frame: 0 },
    playhead: 0,
    shown: undefined,
    spans: [],
    muted: new Set(),
    unplayable: [],
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
    toggleMute: () => {},
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
