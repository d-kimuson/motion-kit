import { createRoot } from 'react-dom/client';

import { previewConfigElementId, previewHostConfigSchema } from '../lib/preview-protocol.ts';
import { createAudioPlayer, mutedSources } from './audio.ts';
import { connectRealm } from './connection.ts';
import { createPreviewController } from './controller.ts';
import { parsePreviewQuery } from './query.ts';
import { PreviewView } from './view.tsx';

// The realm announces itself while its entry module runs, so before its frame's load event.
const startGraceMs = 1000;

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
  const context = new AudioContext();
  const controller = createPreviewController({
    query: query.value,
    connect: (signal) => {
      const element = frame;
      const target = element?.contentWindow;
      if (element === null || target === null || target === undefined)
        return Promise.reject(new Error('Preview frame is not attached'));
      // A frame that loads without announcing its realm failed to import or run the entry.
      const silent = new AbortController();
      let grace: ReturnType<typeof setTimeout> | undefined;
      const onLoad = () => {
        if (target.location.href === 'about:blank') return;
        grace = setTimeout(() => silent.abort(), startGraceMs);
      };
      element.addEventListener('load', onLoad);
      const connecting = connectRealm(
        { events: window, frame: target, origin: window.location.origin },
        AbortSignal.any([signal, silent.signal]),
      );
      // Assigning the same URL navigates again, which is the reload.
      element.src = shellUrl;
      return connecting.finally(() => {
        element.removeEventListener('load', onLoad);
        clearTimeout(grace);
      });
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
    muted: mutedSources(window.localStorage, projectRoot),
    choose: (compositionId) => {
      const params = new URLSearchParams(window.location.search);
      params.set('composition', compositionId);
      window.history.replaceState(null, '', `?${params.toString()}`);
    },
  });
  // The server sends `reload` after a module the realm loaded changed; the realm is rebuilt.
  new EventSource(eventsUrl).addEventListener('reload', () => void controller.reload());
  createRoot(root).render(
    <PreviewView
      controller={controller}
      frame={(element) => {
        frame = element;
      }}
    />,
  );
};
