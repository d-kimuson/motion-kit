import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { previewHostConfigSchema } from '../../lib/preview-protocol.ts';
import { openPreviewSession, type PreviewSession } from './preview-session.ts';

const require = createRequire(import.meta.url);
const directories: string[] = [];
const sessions: PreviewSession[] = [];
const scene = (text: string) =>
  `import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';
export const compositions = defineCompositions([defineComposition({
id: 'clip', component: () => <div>${text}</div>, schema: z.object({}),
width: 320, height: 180, fps: { numerator: 30, denominator: 1 }, durationInFrames: 10 })]);`;
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'motion-kit-preview-project-'));
  directories.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(dirname(require.resolve(`${name}/package.json`)), join(root, 'node_modules', name));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'entry.tsx'), scene('first'));
  writeFileSync(join(root, 'vite.config.ts'), 'export default {};');
  mkdirSync(join(root, 'audio'));
  writeFileSync(join(root, 'audio/voice.wav'), 'RIFF-not-really');
  writeFileSync(join(root, 'audio/take #1?.wav'), 'RIFF-take');
  return root;
};
const open = async (root: string, port?: number) => {
  const result = await openPreviewSession({
    projectRoot: root,
    entry: 'entry.tsx',
    ...(port === undefined ? {} : { port }),
  });
  if (result.ok) sessions.push(result.value);
  return result;
};
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** Reads server-sent events until `predicate` matches one, or gives up. */
const nextEvent = async (url: string, predicate: (event: string) => boolean) => {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (reader === undefined) throw new Error('No event stream');
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Event stream ended');
      buffer += value;
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      const found = events.find(predicate);
      if (found !== undefined) return found;
    }
  } finally {
    controller.abort();
  }
};

/**
 * Writes `write` until `settled` resolves. The watcher scans the paths it is given
 * asynchronously, so a write right after the session opens can land before it watches them.
 */
const writeUntil = async <T>(settled: Promise<T>, write: () => void): Promise<T> => {
  let done = false;
  const result = settled.finally(() => {
    done = true;
  });
  while (!done) {
    write();
    await Promise.race([result, new Promise((resolve) => setTimeout(resolve, 500))]);
  }
  return result;
};

it('reports a temporary directory it cannot create as a failure, not a rejection', async () => {
  const root = fixture();
  const previous = process.env['TMPDIR'];
  process.env['TMPDIR'] = join(root, 'missing', 'tmp');
  try {
    await expect(open(root)).resolves.toMatchObject({
      ok: false,
      error: { code: 'render.page-error', message: 'Loading workspace creation failed.' },
    });
  } finally {
    if (previous === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = previous;
  }
});

it('serves the host page, the preview shell and audio under the Vite fs policy', async () => {
  const root = fixture();
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const { url } = result.value;
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/__motion-kit\/preview\/$/);
  const host = await (await fetch(url)).text();
  const config = previewHostConfigSchema.parse(
    JSON.parse(/<script type="application\/json"[^>]*>(.*?)<\/script>/.exec(host)?.[1] ?? '{}'),
  );
  expect(config).toEqual({
    projectRoot: root,
    shellUrl: '/__motion-kit/?host=preview',
    eventsUrl: '/__motion-kit/preview/events',
    audioUrl: '/__motion-kit/preview/audio',
  });
  expect(host).toContain('/@id/virtual:motion-kit-preview-entry');
  const entry = await fetch(new URL('/@id/virtual:motion-kit-preview-entry', url));
  expect(entry.status).toBe(200);
  expect(await entry.text()).toContain('startPreviewHost');
  expect((await fetch(new URL(config.shellUrl, url))).status).toBe(200);

  const audio = new URL(config.audioUrl, url);
  audio.searchParams.set('src', 'audio/voice.wav');
  const served = await fetch(audio);
  expect(served.headers.get('cache-control')).toBe('no-store');
  expect(await served.text()).toBe('RIFF-not-really');
  audio.searchParams.set('src', 'audio/take #1?.wav');
  expect(await (await fetch(audio)).text()).toBe('RIFF-take');
  audio.searchParams.set('src', '/etc/hosts');
  expect((await fetch(audio)).status).toBe(403);
  audio.searchParams.set('src', 'audio/missing.wav');
  expect((await fetch(audio)).status).toBe(404);
  audio.searchParams.set('src', 'audio');
  expect((await fetch(audio)).status).toBe(404);
  audio.searchParams.delete('src');
  expect((await fetch(audio)).status).toBe(400);
});

/** A GET with the given Host header; a DNS-rebound page sends its own site's name. */
const statusFromHost = (url: URL, host: string) =>
  new Promise<number | undefined>((settle, fail) => {
    get(url, { headers: { host } }, (response) => {
      response.resume();
      settle(response.statusCode);
    }).on('error', fail);
  });

it("applies Vite's Host check to the preview routes", async () => {
  const result = await open(fixture());
  if (!result.ok) throw new Error('Preview failed to start');
  const { url } = result.value;
  const audio = new URL('/__motion-kit/preview/audio?src=audio/voice.wav', url);
  const events = new URL('/__motion-kit/preview/events', url);
  for (const route of [new URL(url), audio, events]) {
    expect(await statusFromHost(route, 'rebound.example')).toBe(403);
  }
  // A port forward changes the port in the Host, which Vite accepts for a loopback name.
  expect(await statusFromHost(audio, 'localhost:9000')).toBe(200);
  expect(await statusFromHost(audio, '[::1]:9000')).toBe(200);
});

it('keeps the Host check under a project config that would switch it off', async () => {
  const root = fixture();
  // Vite skips its Host check under either option; the service answers plain http regardless.
  writeFileSync(
    join(root, 'vite.config.ts'),
    'export default { server: { allowedHosts: true, https: {} } };',
  );
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const audio = new URL('/__motion-kit/preview/audio?src=audio/voice.wav', result.value.url);
  expect(await statusFromHost(audio, 'rebound.example')).toBe(403);
  expect(await statusFromHost(new URL('/entry.tsx', audio), 'rebound.example')).toBe(403);
});

it('emits reload when a served module changes and serves the new source', async () => {
  const root = fixture();
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const module = new URL(`/@fs${join(root, 'entry.tsx')}`, result.value.url);
  expect(await (await fetch(module)).text()).toContain('first');
  const event = await writeUntil(
    nextEvent(new URL('/__motion-kit/preview/events', result.value.url).href, (text) =>
      text.startsWith('event: reload'),
    ),
    () => writeFileSync(join(root, 'entry.tsx'), scene('second')),
  );
  expect(event).toBe('event: reload\ndata: {}');
  expect(await (await fetch(module)).text()).toContain('second');
});

it('keeps serving after a module fails to transform, so the next save recovers', async () => {
  const root = fixture();
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const module = new URL(`/@fs${join(root, 'entry.tsx')}`, result.value.url);
  const events = new URL('/__motion-kit/preview/events', result.value.url).href;
  await writeUntil(
    nextEvent(events, (text) => text.startsWith('event: reload')),
    () => writeFileSync(join(root, 'entry.tsx'), 'const = ;'),
  );
  expect((await fetch(module)).ok).toBe(false);
  const ended = await Promise.race([
    result.value.failed.then(() => true),
    new Promise<false>((settle) => setTimeout(() => settle(false), 500)),
  ]);
  expect(ended).toBe(false);
  await writeUntil(
    nextEvent(events, (text) => text.startsWith('event: reload')),
    () => writeFileSync(join(root, 'entry.tsx'), scene('fixed')),
  );
  expect(await (await fetch(module)).text()).toContain('fixed');
});

it('emits reload when an audio file the host fetched changes', async () => {
  const root = fixture();
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const audio = new URL('/__motion-kit/preview/audio', result.value.url);
  audio.searchParams.set('src', 'audio/voice.wav');
  expect(await (await fetch(audio)).text()).toBe('RIFF-not-really');
  const event = await writeUntil(
    nextEvent(new URL('/__motion-kit/preview/events', result.value.url).href, (text) =>
      text.startsWith('event: reload'),
    ),
    () => writeFileSync(join(root, 'audio/voice.wav'), 'RIFF-replaced'),
  );
  expect(event).toBe('event: reload\ndata: {}');
  expect(await (await fetch(audio)).text()).toBe('RIFF-replaced');
});

it('ends the session when the Vite config changes', async () => {
  const root = fixture();
  const result = await open(root);
  if (!result.ok) throw new Error('Preview failed to start');
  const failed = await writeUntil(result.value.failed, () =>
    writeFileSync(join(root, 'vite.config.ts'), 'export default { base: "/" };'),
  );
  expect(failed).toMatchObject({
    code: 'render.page-error',
    message: 'The Vite config vite.config.ts changed, so the preview stopped.',
  });
});

it('listens on a requested port and reports one already taken', async () => {
  const blocker = createServer();
  await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
  const address = blocker.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  try {
    expect(await open(fixture(), address.port)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: `Port ${address.port} on 127.0.0.1 is already in use.`,
        hint: 'Stop the process listening on it, or choose another port.',
      },
    });
  } finally {
    blocker.close();
  }
  const free = createServer();
  await new Promise<void>((done) => free.listen(0, '127.0.0.1', done));
  const freeAddress = free.address();
  if (freeAddress === null || typeof freeAddress === 'string') throw new Error('No port');
  await new Promise<void>((done) => free.close(() => done()));
  const result = await open(fixture(), freeAddress.port);
  expect(result.ok && result.value.url).toBe(
    `http://127.0.0.1:${freeAddress.port}/__motion-kit/preview/`,
  );
});

it('removes its workspace and stops the service on disposal', async () => {
  const result = await open(fixture());
  if (!result.ok) throw new Error('Preview failed to start');
  const pid = result.value.servicePid;
  expect(await result.value.dispose()).toEqual({ ok: true, value: undefined });
  expect(() => process.kill(pid, 0)).toThrow('ESRCH');
});
