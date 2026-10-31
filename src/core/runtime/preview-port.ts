import { type FramePage } from '../../lib/frame-protocol.ts';
import { type LoadingPage } from '../../lib/loading-protocol.ts';
import {
  previewConnectSchema,
  previewProtocolVersion,
  previewRequestSchema,
  type PreviewReply,
  type PreviewRequest,
  type ShowOutcome,
} from '../../lib/preview-protocol.ts';

/** The window a preview realm talks through; injected so the handshake is testable. */
export type PreviewHostWindow = Readonly<{
  events: Pick<EventTarget, 'addEventListener'>;
  parent: MessageEventSource & Pick<Window, 'postMessage'>;
  origin: string;
}>;

// Preview has no supervisor that could recycle the user's browser, so the page bounds its own
// loading and frames (core's frame timeout, not an external deadline).
const loadingTimeoutMs = 30_000;

// Completing the lease is the preview's presentation: the committed frame stays on screen and
// ownership is released without a screenshot.
const present = async (
  page: LoadingPage,
  outcome: Awaited<ReturnType<FramePage['settleFrame']>>,
): Promise<ShowOutcome> => {
  if (outcome.status !== 'ready') return outcome;
  const completion = page.completeCapture(outcome.lease);
  if (completion.status === 'accepted')
    return {
      status: 'shown',
      frame: outcome.lease.globalFrame,
      sequences: page.sequences(),
    };
  if (completion.status !== 'resettle') return completion;
  return present(page, await page.resettle(outcome.lease));
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
        void answerPreview(page, request.data).then((reply) => port.postMessage(reply));
    });
    port.start();
  });
  host.parent.postMessage(
    { type: 'motion-kit-preview-ready', protocolVersion: previewProtocolVersion },
    host.origin,
  );
};
