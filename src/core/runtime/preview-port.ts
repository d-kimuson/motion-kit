import { z } from 'zod';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { pendingAssetSchema, type FramePage } from '../../lib/frame-protocol.ts';
import { type LoadingPage } from '../../lib/loading-protocol.ts';
import {
  previewConnectSchema,
  previewProtocolVersion,
  previewRequestSchema,
  type PreviewReply,
  type PreviewRequest,
  type RegisteredAsset,
  type ShowOutcome,
} from '../../lib/preview-protocol.ts';
import { describeTree, inspectPoint } from './inspect.ts';

/** The window a preview realm talks through; injected so the handshake is testable. */
export type PreviewHostWindow = Readonly<{
  events: Pick<EventTarget, 'addEventListener'>;
  parent: MessageEventSource & Pick<Window, 'postMessage'>;
  origin: string;
  /** The shell URL's `load`, echoed in the announcement. */
  load: string;
}>;

// Preview has no supervisor that could recycle the user's browser, so the page bounds its own
// loading and frames (core's frame timeout, not an external deadline).
const loadingTimeoutMs = 30_000;

/** Each asset once, though several registrations use it; the first status listed wins. */
const unique = (assets: readonly RegisteredAsset[]): RegisteredAsset[] => [
  ...new Map(assets.map((asset) => [`${asset.kind}\0${asset.source}`, asset])).values(),
];

/**
 * The fonts and images registered for the frame that settled. A render cut off before it committed
 * (a Suspense boundary that suspended on mount, a frame a newer one replaced) never releases its
 * registrations, so only those of this frame's generation or of a committed owner count.
 */
const registered = (page: LoadingPage, generation: number): RegisteredAsset[] => {
  const { pending, failed, ready } = page.assetReadiness(generation);
  return unique(
    [
      ...failed.map((asset) => ({ ...asset, status: 'failed' as const })),
      ...pending.map((asset) => ({ ...asset, status: 'pending' as const })),
      ...ready.map((asset) => ({ ...asset, status: 'ready' as const })),
    ].map(({ kind, source, status }) => ({ kind, source, status })),
  );
};

const listedAssets = z.object({ assets: z.array(pendingAssetSchema) });
/**
 * The assets a failed frame names in its asset diagnostics. The registry is no guide then: the
 * failed subtree never committed, so it still holds the last frame's registrations.
 */
const failedAssets = (diagnostics: readonly Diagnostic[]): RegisteredAsset[] =>
  unique(
    diagnostics.flatMap((diagnostic) => {
      const status =
        diagnostic.code === 'asset.load-failed'
          ? 'failed'
          : diagnostic.code === 'asset.not-ready'
            ? 'pending'
            : undefined;
      const listed = listedAssets.safeParse(diagnostic.details);
      if (status === undefined || !listed.success) return [];
      return listed.data.assets.map(({ kind, source }) => ({ kind, source, status }));
    }),
  );

// Completing the lease is the preview's presentation: the committed frame stays on screen and
// ownership is released without a screenshot.
const present = async (
  page: LoadingPage,
  outcome: Awaited<ReturnType<FramePage['settleFrame']>>,
): Promise<ShowOutcome> => {
  if (outcome.status === 'aborted') return outcome;
  if (outcome.status === 'failed') return { ...outcome, assets: failedAssets(outcome.diagnostics) };
  const completion = page.completeCapture(outcome.lease);
  if (completion.status === 'accepted')
    return {
      status: 'shown',
      frame: outcome.lease.globalFrame,
      sequences: page.sequences(),
      assets: registered(page, outcome.lease.generation),
    };
  if (completion.status === 'resettle') return present(page, await page.resettle(outcome.lease));
  return completion.status === 'failed'
    ? { ...completion, assets: failedAssets(completion.diagnostics) }
    : completion;
};

const unanswered = (error: unknown): Diagnostic => ({
  code: 'internal.unexpected',
  severity: 'error',
  message: `The preview realm could not answer: ${error instanceof Error ? error.message : String(error)}`,
  hint: 'Read the error in the browser console, then save a fix; the preview reloads on its own.',
});
/** A request whose answer threw still gets a reply, so the host never waits on it. */
const failedReply = (request: PreviewRequest, error: unknown): PreviewReply => {
  const diagnostic = unanswered(error);
  if (request.type === 'list')
    return { type: 'listed', id: request.id, result: { ok: false, error: diagnostic } };
  if (request.type === 'mount')
    return { type: 'mounted', id: request.id, result: { ok: false, error: diagnostic } };
  if (request.type === 'inspect')
    return { type: 'inspected', id: request.id, result: { ok: false, error: diagnostic } };
  if (request.type === 'describe')
    return { type: 'described', id: request.id, result: { ok: false, error: diagnostic } };
  return {
    type: 'shown',
    id: request.id,
    outcome: { status: 'failed', diagnostics: [diagnostic], assets: [] },
  };
};

/** One preview request against the realm's Loading Page. */
export const answerPreview = async (
  page: LoadingPage,
  request: PreviewRequest,
): Promise<PreviewReply> => {
  if (request.type === 'list')
    return { type: 'listed', id: request.id, result: page.listCompositions() };
  if (request.type === 'mount')
    return {
      type: 'mounted',
      id: request.id,
      result: await page.mount({
        ...(request.compositionId === undefined ? {} : { compositionId: request.compositionId }),
        props: request.props,
        revision: crypto.randomUUID(),
        instance: crypto.randomUUID(),
        loadingTimeoutMs,
      }),
    };
  // The element the Loading Page mounts into; the Composition draws nothing outside it.
  const root = () => document.getElementById('motion-kit-root');
  if (request.type === 'inspect') {
    const element = root();
    return {
      type: 'inspected',
      id: request.id,
      result: {
        ok: true,
        value: element === null ? null : inspectPoint(element, request.x, request.y),
      },
    };
  }
  if (request.type === 'describe') {
    const element = root();
    return {
      type: 'described',
      id: request.id,
      result: { ok: true, value: element === null ? null : describeTree(element) },
    };
  }
  const outcome = await page.settleFrame(request.frame, {
    source: 'preview',
    requestId: crypto.randomUUID(),
  });
  return { type: 'shown', id: request.id, outcome: await present(page, outcome) };
};

/**
 * Announce the realm to its parent and serve the first port the parent transfers. Only the parent
 * window at this realm's own origin may connect, and only once.
 */
export const servePreviewPort = (page: LoadingPage, host: PreviewHostWindow): void => {
  let connected = false;
  host.events.addEventListener('message', (event) => {
    if (connected || !(event instanceof MessageEvent)) return;
    if (event.source !== host.parent || event.origin !== host.origin) return;
    const port = event.ports[0];
    if (!previewConnectSchema.safeParse(event.data).success || port === undefined) return;
    connected = true;
    port.addEventListener('message', (message) => {
      const request = previewRequestSchema.safeParse(message.data);
      if (request.success)
        void answerPreview(page, request.data)
          .catch((error: unknown) => {
            console.error(error);
            return failedReply(request.data, error);
          })
          .then((reply) => port.postMessage(reply));
    });
    port.start();
  });
  host.parent.postMessage(
    { type: 'motion-kit-preview-ready', protocolVersion: previewProtocolVersion, load: host.load },
    host.origin,
  );
};
