import { createRoot } from 'react-dom/client';

import {
  previewConfigElementId,
  previewHostConfigSchema,
  previewLoadParameter,
  previewReloadEvent,
} from '../lib/preview-protocol.ts';
import { createAudioPlayer, mutedSources } from './audio.ts';
import { connectRealm } from './connection.ts';
import { createPreviewController } from './controller.ts';
import { parsePreviewQuery, withCompositionId } from './query.ts';
import { PreviewView } from './view.tsx';

// Reading `localStorage` throws where the browser blocks site data; mutes then last for the page.
const siteStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
};

const fail = (root: HTMLElement, message: string) => {
  root.textContent = message;
};

/**
 * Boot the preview host page the loading server serves (docs/design-doc/20261101-browser-preview.md):
 * it embeds the composition realm in an iframe and drives it over a MessagePort.
 */
export const startPreviewHost = (): void => {
  const root = document.getElementById('motion-kit-preview');
  if (root === null) return;
  const config = previewHostConfigSchema.safeParse(
    JSON.parse(document.getElementById(previewConfigElementId)?.textContent ?? 'null'),
  );
  if (!config.success) {
    fail(root, 'The preview host configuration is missing; restart `motion-kit preview`.');
    return;
  }
  const query = parsePreviewQuery(window.location.search);
  if (!query.ok) {
    fail(root, `${query.error.message} ${query.error.hint}`);
    return;
  }
  const { shellUrl, eventsUrl, audioUrl, projectRoot } = config.data;
  let frame: HTMLIFrameElement | null = null;
  let loads = 0;
  const context = new AudioContext();
  const controller = createPreviewController({
    query: query.value,
    connect: (signal) => {
      const element = frame;
      const target = element?.contentWindow;
      if (element === null || target === null || target === undefined)
        return Promise.reject(new Error('Preview frame is not attached'));
      loads += 1;
      const load = String(loads);
      const connecting = connectRealm(
        { events: window, frame: target, origin: window.location.origin },
        load,
        signal,
      );
      const url = new URL(shellUrl, window.location.href);
      url.searchParams.set(previewLoadParameter, load);
      element.src = url.href;
      return connecting;
    },
    audio: createAudioPlayer(context, async (src) => {
      const response = await fetch(`${audioUrl}?${new URLSearchParams({ src }).toString()}`);
      if (!response.ok) throw new Error(`Audio ${src} answered ${response.status}`);
      return response.arrayBuffer();
    }),
    clock: { now: () => context.currentTime, resume: () => context.resume() },
    interval: {
      start: (tick, ms) => {
        const handle = setInterval(tick, ms);
        return () => clearInterval(handle);
      },
    },
    muted: mutedSources(siteStorage(), projectRoot),
    choose: (compositionId) =>
      window.history.replaceState(
        null,
        '',
        withCompositionId(window.location.search, compositionId),
      ),
  });
  // The server sends `reload` after a module the realm loaded changed; the realm is rebuilt.
  new EventSource(eventsUrl).addEventListener(previewReloadEvent, () => void controller.reload());
  createRoot(root).render(
    <PreviewView
      controller={controller}
      frame={(element) => {
        frame = element;
      }}
    />,
  );
};
