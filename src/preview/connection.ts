import { type LoadingDescriptor, type MountReceipt } from '../lib/loading-protocol.ts';
import {
  type InspectedElement,
  previewFailedSchema,
  previewProtocolVersion,
  previewReadySchema,
  previewReplySchema,
  type PreviewReply,
  type ShowOutcome,
} from '../lib/preview-protocol.ts';
import { type Result } from '../lib/result.ts';

/** The host window and the realm frame it embeds; injected so the handshake is testable. */
export type RealmWindow = Readonly<{
  events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** The iframe's `contentWindow`. */
  frame: { postMessage: (message: unknown, options: WindowPostMessageOptions) => void };
  origin: string;
}>;

/** Requests to one connected realm; a reload replaces the realm, so a new connection follows. */
export type Realm = Readonly<{
  list: () => Promise<Result<readonly LoadingDescriptor[]>>;
  mount: (compositionId: string | undefined, props: unknown) => Promise<Result<MountReceipt>>;
  show: (frame: number) => Promise<ShowOutcome>;
  /** The element at a design-pixel point of the mounted Composition; null when there is none. */
  inspect: (x: number, y: number) => Promise<Result<InspectedElement | null>>;
  /** Rejects every pending request; the realm's page goes with its frame. */
  close: () => void;
}>;

const closed = () => new Error('Preview realm closed');

type Pending = Readonly<{ type: PreviewReply['type']; settle: (reply: PreviewReply) => void }>;

const client = (port: MessagePort): Realm => {
  let nextId = 1;
  const pending = new Map<number, Pending & { reject: (error: Error) => void }>();
  port.addEventListener('message', (event) => {
    const reply = previewReplySchema.safeParse(event.data);
    if (!reply.success) return;
    const waiting = pending.get(reply.data.id);
    if (waiting?.type !== reply.data.type) return;
    pending.delete(reply.data.id);
    waiting.settle(reply.data);
  });
  port.start();
  const send = <T>(
    type: PreviewReply['type'],
    request: (id: number) => unknown,
    pick: (reply: PreviewReply) => T,
  ) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { type, settle: (reply) => resolve(pick(reply)), reject });
      port.postMessage(request(id));
    });
  return {
    list: () =>
      send(
        'listed',
        (id) => ({ type: 'list', id }),
        (reply) => (reply.type === 'listed' ? reply.result : unreachable()),
      ),
    mount: (compositionId, props) =>
      send(
        'mounted',
        (id) => ({
          type: 'mount',
          id,
          ...(compositionId === undefined ? {} : { compositionId }),
          props,
        }),
        (reply) => (reply.type === 'mounted' ? reply.result : unreachable()),
      ),
    show: (frame) =>
      send(
        'shown',
        (id) => ({ type: 'show', id, frame }),
        (reply) => (reply.type === 'shown' ? reply.outcome : unreachable()),
      ),
    inspect: (x, y) =>
      send(
        'inspected',
        (id) => ({ type: 'inspect', id, x, y }),
        (reply) => (reply.type === 'inspected' ? reply.result : unreachable()),
      ),
    close: () => {
      for (const waiting of pending.values()) waiting.reject(closed());
      pending.clear();
      port.close();
    },
  };
};
// The client only settles a request with the reply type it registered.
const unreachable = (): never => {
  throw new Error('Preview reply type mismatch');
};

/**
 * Wait for the realm in `frame` to announce itself for `load`, then transfer the port requests
 * travel on. Only the frame at the host's own origin is accepted. Rejects when the frame's shell
 * reports that the entry of that load failed to start; there is no deadline, since an entry may
 * await before announcing.
 */
export const connectRealm = (
  host: RealmWindow,
  load: string,
  signal?: AbortSignal,
): Promise<Realm> =>
  new Promise((resolve, reject) => {
    const onMessage = (event: Event) => {
      if (!(event instanceof MessageEvent)) return;
      if (event.source !== host.frame || event.origin !== host.origin) return;
      if (previewFailedSchema.safeParse(event.data).data?.load === load) {
        stop();
        reject(new Error('Preview realm failed to start'));
        return;
      }
      if (previewReadySchema.safeParse(event.data).data?.load !== load) return;
      stop();
      const channel = new MessageChannel();
      host.frame.postMessage(
        { type: 'motion-kit-preview-connect', protocolVersion: previewProtocolVersion },
        { targetOrigin: host.origin, transfer: [channel.port2] },
      );
      resolve(client(channel.port1));
    };
    const onAbort = () => {
      stop();
      reject(closed());
    };
    const stop = () => {
      host.events.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted === true) {
      reject(closed());
      return;
    }
    host.events.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
