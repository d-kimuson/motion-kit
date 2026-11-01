import { createRoot } from 'react-dom/client';

import {
  previewConfigElementId,
  previewHostConfigSchema,
  previewLoadParameter,
  previewReloadEvent,
  previewReloadSchema,
} from '../lib/preview-protocol.ts';
import { createAudioPlayer, mutedSources } from './audio.ts';
import { createCommentBook } from './comment-book.ts';
import { connectRealm } from './connection.ts';
import { createPreviewController } from './controller.ts';
import { parsePreviewQuery, withCompositionId } from './query.ts';
import { createReviewController } from './review.ts';
import { PreviewView } from './view.tsx';

// Reading `localStorage` throws where the browser blocks site data; mutes and comments then last
// for the page.
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
  const { shellUrl, eventsUrl, audioUrl, projectRoot, realProjectRoot, entry, viteConfig } =
    config.data;
  const storage = siteStorage();
  let frame: HTMLIFrameElement | null = null;
  let loads = 0;
  const context = new AudioContext();
  const controller = createPreviewController({
    query: query.value,
    connect: (signal) => {
      const target = frame?.contentWindow;
      if (target === null || target === undefined)
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
      // Replacing the location keeps reloads out of the session history, so Back leaves the preview.
      target.location.replace(url.href);
      return connecting;
    },
    audio: createAudioPlayer(context, async (src) => {
      const response = await fetch(`${audioUrl}?${new URLSearchParams({ src }).toString()}`);
      if (!response.ok) throw new Error(`Audio ${src} answered ${response.status}`);
      return response.arrayBuffer();
    }),
    clock: {
      now: () => context.currentTime,
      // Browsers that do not report the output latency leave it undefined.
      latency: () => context.baseLatency + (context.outputLatency ?? 0),
      resume: () => context.resume(),
    },
    interval: {
      start: (tick, ms) => {
        const handle = setInterval(tick, ms);
        return () => clearInterval(handle);
      },
    },
    muted: mutedSources(storage, projectRoot),
    choose: (compositionId) =>
      window.history.replaceState(
        null,
        '',
        withCompositionId(window.location.search, compositionId),
      ),
  });
  // The server sends `reload` after a module the realm loaded changed; the realm is rebuilt.
  new EventSource(eventsUrl).addEventListener(previewReloadEvent, (event) => {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      data = undefined;
    }
    const changed = previewReloadSchema.safeParse(data);
    // Data it cannot read may be an audio change; decoding again is only slower.
    void controller.reload({ audio: changed.success ? changed.data.audio : true });
  });
  const book = createCommentBook(storage, projectRoot, entry);
  const review = {
    controller: createReviewController({ preview: controller, book }),
    book,
    site: {
      projectRoot,
      realProjectRoot,
      entry,
      ...(viteConfig === undefined ? {} : { viteConfig }),
      props: query.value.props,
    },
  };
  createRoot(root).render(
    <PreviewView
      controller={controller}
      frame={(element) => {
        frame = element;
      }}
      review={review}
    />,
  );
};
