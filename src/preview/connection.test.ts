import { afterEach, expect, it } from 'vitest';

import {
  previewConnectSchema,
  previewRequestSchema,
  type PreviewReply,
} from '../lib/preview-protocol.ts';
import { connectRealm, type RealmWindow } from './connection.ts';

const origin = 'http://127.0.0.1:4000';
const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** A fake host window plus the realm frame it hosts; the realm answers through `answer`. */
const harness = (answer: (request: unknown) => PreviewReply | undefined) => {
  const events = new EventTarget();
  const connects: unknown[] = [];
  const frame: RealmWindow['frame'] = {
    postMessage: (message: unknown, options: WindowPostMessageOptions) => {
      connects.push({ message, targetOrigin: options.targetOrigin });
      const port = options.transfer?.[0];
      if (!(port instanceof MessagePort) || !previewConnectSchema.safeParse(message).success)
        return;
      ports.push(port);
      port.addEventListener('message', (event) => {
        const reply = answer(event.data);
        if (reply !== undefined) port.postMessage(reply);
      });
      port.start();
    },
  };
  // Node's MessageEvent only takes a MessagePort as its source; a browser's carries the window.
  const announce = (data: unknown, from: { source?: unknown; origin?: string } = {}) => {
    const event = new MessageEvent('message', { data, origin: from.origin ?? origin });
    Object.defineProperty(event, 'source', { value: from.source ?? frame });
    events.dispatchEvent(event);
  };
  return { window: { events, frame, origin } satisfies RealmWindow, connects, announce };
};
const ready = { type: 'motion-kit-preview-ready', protocolVersion: 1, load: '2' };
const failed = { type: 'motion-kit-preview-failed', load: '2' };
const listed = (id: number): PreviewReply => ({
  type: 'listed',
  id,
  result: { ok: true, value: [] },
});

it('connects on the frame announcement and correlates replies by id', async () => {
  const seen: unknown[] = [];
  const fake = harness((request) => {
    const parsed = previewRequestSchema.parse(request);
    seen.push(parsed);
    if (parsed.type === 'show')
      return {
        type: 'shown',
        id: parsed.id,
        outcome: { status: 'shown', frame: parsed.frame, sequences: [] },
      };
    return parsed.type === 'list' ? listed(parsed.id) : undefined;
  });
  const connecting = connectRealm(fake.window, '2');
  fake.announce(ready);
  const realm = await connecting;
  expect(fake.connects).toEqual([
    { message: { type: 'motion-kit-preview-connect', protocolVersion: 1 }, targetOrigin: origin },
  ]);
  const [shown, list] = await Promise.all([realm.show(7), realm.list()]);
  expect(shown).toEqual({ status: 'shown', frame: 7, sequences: [] });
  expect(list).toEqual({ ok: true, value: [] });
  expect(seen).toEqual([
    { type: 'show', id: 1, frame: 7 },
    { type: 'list', id: 2 },
  ]);
  realm.close();
});

it('asks the realm what element is at a design-pixel point', async () => {
  const element = {
    selector: 'h1',
    text: 'Hello',
    source: null,
    box: { x: 0, y: 0, width: 100, height: 40 },
  };
  const fake = harness((request) => {
    const parsed = previewRequestSchema.parse(request);
    return parsed.type === 'inspect'
      ? {
          type: 'inspected',
          id: parsed.id,
          result: { ok: true, value: parsed.x < 100 ? element : null },
        }
      : undefined;
  });
  const connecting = connectRealm(fake.window, '2');
  fake.announce(ready);
  const realm = await connecting;
  expect(await realm.inspect(10, 20)).toEqual({ ok: true, value: element });
  expect(await realm.inspect(500, 20)).toEqual({ ok: true, value: null });
  realm.close();
});

it('ignores announcements from other windows, origins or protocol versions', async () => {
  const fake = harness((request) => listed(previewRequestSchema.parse(request).id));
  const connecting = connectRealm(fake.window, '2');
  fake.announce(ready, { source: {} });
  fake.announce(ready, { origin: 'http://evil.test' });
  fake.announce({ ...ready, protocolVersion: 2 });
  // The document an earlier load left in the frame.
  fake.announce({ ...ready, load: '1' });
  fake.announce({ ...failed, load: '1' });
  expect(fake.connects).toEqual([]);
  fake.announce(ready);
  await connecting;
  expect(fake.connects).toHaveLength(1);
});

it('drops malformed or unknown replies and rejects what is pending on close', async () => {
  const fake = harness((request) => {
    const parsed = previewRequestSchema.parse(request);
    // An id the host never sent.
    return { type: 'listed', id: parsed.id + 100, result: { ok: true, value: [] } };
  });
  const connecting = connectRealm(fake.window, '2');
  fake.announce(ready);
  const realm = await connecting;
  const pending = realm.list();
  await new Promise((done) => setTimeout(done, 20));
  realm.close();
  await expect(pending).rejects.toThrow('Preview realm closed');
});

it('rejects when the frame reports that its entry failed, and only from that frame', async () => {
  const fake = harness(() => undefined);
  const connecting = connectRealm(fake.window, '2');
  fake.announce(failed, { source: {} });
  fake.announce(failed, { origin: 'http://evil.example' });
  fake.announce(failed);
  await expect(connecting).rejects.toThrow('Preview realm failed to start');
  fake.announce(ready);
  expect(fake.connects).toEqual([]);
});

it('stops waiting for an announcement once aborted', async () => {
  const fake = harness(() => undefined);
  const controller = new AbortController();
  const connecting = connectRealm(fake.window, '2', controller.signal);
  controller.abort();
  await expect(connecting).rejects.toThrow('Preview realm closed');
  fake.announce(ready);
  expect(fake.connects).toEqual([]);
});
