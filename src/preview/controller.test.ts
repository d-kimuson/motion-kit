import { expect, it } from 'vitest';

import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type ShowOutcome } from '../lib/preview-protocol.ts';
import { type AudioPlayer } from './audio.ts';
import { type Realm } from './connection.ts';
import { createPreviewController, type PreviewDependencies } from './controller.ts';
import { type ScheduledClip } from './schedule.ts';

const clip = (id: string, audio?: LoadingDescriptor['audio']): LoadingDescriptor => ({
  id,
  width: 320,
  height: 180,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 60,
  ...(audio === undefined ? {} : { audio }),
});
const flush = () => new Promise((done) => setTimeout(done, 0));

/**
 * A realm whose `show` answers only when the test releases it.
 * With `hold`, `mount` stays pending until the realm closes and then rejects, as a closed port does.
 */
const fakeRealm = (compositions: readonly LoadingDescriptor[], hold = false) => {
  const shows: { frame: number; answer: (outcome?: ShowOutcome) => void }[] = [];
  const mounts: { compositionId: string | undefined; props: unknown }[] = [];
  let closed = false;
  let reject: ((error: Error) => void) | undefined;
  const realm: Realm = {
    list: () => Promise.resolve({ ok: true, value: compositions }),
    mount: (compositionId, props) => {
      mounts.push({ compositionId, props });
      if (hold) {
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      }
      if (compositionId === 'broken')
        return Promise.resolve({
          ok: false,
          error: { code: 'render.page-error', severity: 'error', message: 'boom', hint: 'fix' },
        });
      const descriptor = compositions.find(
        (item) => item.id === (compositionId ?? compositions[0]?.id),
      );
      return Promise.resolve(
        descriptor === undefined
          ? {
              ok: false,
              error: {
                code: 'cli.composition-not-found',
                severity: 'error',
                message: 'missing',
                hint: 'pick',
              },
            }
          : { ok: true, value: { instance: 'i', revision: 'r', descriptor } },
      );
    },
    show: (frame) =>
      new Promise((resolve) => {
        shows.push({
          frame,
          answer: (outcome) =>
            resolve(
              outcome ?? {
                status: 'shown',
                frame,
                sequences: [
                  {
                    path: [frame < 30 ? 'intro' : 'outro'],
                    startFrame: frame < 30 ? 0 : 30,
                    endFrame: frame < 30 ? 30 : 60,
                  },
                ],
                assets: [
                  { kind: 'font', source: '/inter.woff2', status: 'ready' },
                  ...(frame < 30
                    ? []
                    : [{ kind: 'image', source: '/photo.png', status: 'ready' } as const]),
                ],
              },
            ),
        });
      }),
    describe: () =>
      closed
        ? Promise.reject(new Error('Preview realm closed'))
        : Promise.resolve({ ok: true, value: { nodes: [], truncated: true } }),
    inspect: (x, y) =>
      closed
        ? Promise.reject(new Error('Preview realm closed'))
        : Promise.resolve({
            ok: true,
            value: { selector: 'p', text: '', source: null, box: { x, y, width: 1, height: 1 } },
          }),
    close: () => {
      closed = true;
      reject?.(new Error('Preview realm closed'));
    },
  };
  return { realm, shows, mounts, closed: () => closed };
};

const setup = (
  options: {
    compositions?: readonly LoadingDescriptor[];
    /** What the realms after the first register, as after a save that renamed a Composition. */
    later?: readonly LoadingDescriptor[];
    compositionId?: string;
    /** The realm frame loads but never announces itself. */
    silent?: boolean;
    prepare?: AudioPlayer['prepare'];
    /** The first realm's mount stays pending until that realm closes. */
    holdFirstMount?: boolean;
    /** Seconds between starting a sound and hearing it. */
    latency?: number;
    /** The browser refuses to resume the audio clock. */
    resumeFails?: boolean;
    /** The scan realm connects; without it, its frame never starts. */
    scanner?: boolean;
  } = {},
) => {
  const realms: ReturnType<typeof fakeRealm>[] = [];
  const scanners: ReturnType<typeof fakeRealm>[] = [];
  const started: { clips: readonly ScheduledClip[]; muted: ReadonlySet<string> }[] = [];
  const events: string[] = [];
  const saved: ReadonlySet<string>[] = [];
  const chosen: string[] = [];
  let now = 100;
  let tick: (() => void) | undefined;
  let forgotten = 0;
  const audio: AudioPlayer = {
    prepare:
      options.prepare ?? ((srcs) => Promise.resolve(srcs.filter((src) => src.startsWith('bad')))),
    start: (clips, muted) => {
      started.push({ clips, muted });
    },
    setMuted: (src, muted) => events.push(`${muted ? 'mute' : 'unmute'} ${src}`),
    stop: () => events.push('stop'),
    forget: () => {
      forgotten += 1;
    },
  };
  const deps: PreviewDependencies = {
    query: {
      props: { title: 'hi' },
      fps: 10,
      ...(options.compositionId === undefined ? {} : { compositionId: options.compositionId }),
    },
    connect: () => {
      if (options.silent === true) return Promise.reject(new Error('Preview realm closed'));
      const realm = fakeRealm(
        (realms.length > 0 ? options.later : undefined) ??
          options.compositions ?? [clip('clip', [{ src: 'voice.wav' }, { src: 'bad.wav' }])],
        options.holdFirstMount === true && realms.length === 0,
      );
      realms.push(realm);
      return Promise.resolve(realm.realm);
    },
    connectScanner: () => {
      if (options.scanner !== true) return Promise.reject(new Error('Preview realm closed'));
      const realm = fakeRealm(
        (realms.length > 1 ? options.later : undefined) ??
          options.compositions ?? [clip('clip', [{ src: 'voice.wav' }, { src: 'bad.wav' }])],
      );
      scanners.push(realm);
      return Promise.resolve(realm.realm);
    },
    audio,
    clock: {
      now: () => now,
      latency: () => options.latency ?? 0,
      resume: () =>
        options.resumeFails === true
          ? Promise.reject(new Error('The AudioContext was not allowed to start'))
          : Promise.resolve(),
    },
    interval: {
      start: (next, ms) => {
        expect(ms).toBe(100);
        tick = next;
        return () => {
          tick = undefined;
        };
      },
    },
    muted: { load: () => new Set(['voice.wav']), save: (muted) => void saved.push(muted) },
    choose: (id) => void chosen.push(id),
  };
  const controller = createPreviewController(deps);
  return {
    controller,
    realms,
    scanners,
    started,
    events,
    saved,
    chosen,
    advance: (seconds: number) => {
      now += seconds;
      tick?.();
    },
    ticking: () => tick !== undefined,
    forgotten: () => forgotten,
  };
};

it('mounts the only Composition, shows the playhead and accumulates named Sequence spans', async () => {
  const host = setup();
  await host.controller.reload();
  const realm = host.realms[0];
  expect(realm?.mounts).toEqual([{ compositionId: 'clip', props: { title: 'hi' } }]);
  expect(host.controller.state()).toMatchObject({
    session: { kind: 'ready', descriptor: { id: 'clip' } },
    playhead: 0,
    unplayable: ['bad.wav'],
    muted: new Set(['voice.wav']),
  });
  realm?.shows[0]?.answer();
  await flush();
  host.controller.seek(45);
  realm?.shows[1]?.answer();
  await flush();
  host.controller.seek(10);
  realm?.shows[2]?.answer();
  await flush();
  expect(host.controller.state().spans).toEqual([
    { path: ['intro'], startFrame: 0, endFrame: 30 },
    { path: ['outro'], startFrame: 30, endFrame: 60 },
  ]);
  expect(host.controller.state().shown).toMatchObject({ status: 'shown', frame: 10 });
});

it('accumulates the registered assets with the frame each was first seen at and its latest status', async () => {
  const host = setup();
  await host.controller.reload();
  const realm = host.realms[0];
  realm?.shows[0]?.answer();
  await flush();
  host.controller.seek(40);
  realm?.shows[1]?.answer();
  await flush();
  host.controller.seek(50);
  realm?.shows[2]?.answer({
    status: 'failed',
    diagnostics: [{ code: 'asset.load-failed', severity: 'error', message: 'm', hint: 'h' }],
    assets: [{ kind: 'image', source: '/photo.png', status: 'failed' }],
  });
  await flush();
  expect(host.controller.state().assets).toEqual([
    { kind: 'font', source: '/inter.woff2', status: 'ready', frame: 0 },
    { kind: 'image', source: '/photo.png', status: 'failed', frame: 40 },
  ]);
  await host.controller.reload();
  expect(host.controller.state().assets).toEqual([]);
});

it('spans each asset group over the frames shown, bridging only the frames playback skipped', async () => {
  const host = setup();
  await host.controller.reload();
  const realm = host.realms[0];
  const answered = new Set<number>();
  const answerAll = async () => {
    for (const [index, show] of (realm?.shows ?? []).entries()) {
      if (answered.has(index)) continue;
      answered.add(index);
      show.answer();
      await flush();
    }
  };
  const spans = () =>
    host.controller
      .state()
      .assetSpans.map(({ group, start, end }) => `${group.label} [${start}, ${end})`);
  await answerAll();
  // A seek while paused is not a continuation, so the frames between stay unknown.
  host.controller.seek(20);
  await answerAll();
  expect(spans()).toEqual(['inter.woff2 [0, 1)', 'inter.woff2 [20, 21)']);
  await host.controller.play();
  await answerAll();
  host.advance(0.5);
  await answerAll();
  host.advance(0.5);
  await answerAll();
  host.controller.pause();
  // Playback showed 20, 35 and 50 at 30 fps, skipping the frames between.
  expect(realm?.shows.map((show) => show.frame)).toEqual([0, 20, 20, 35, 50]);
  expect(spans()).toEqual([
    'inter.woff2 [0, 1)',
    'inter.woff2 [20, 51)',
    // The photo is used from frame 30, but the first frame shown with it was 35.
    'photo.png [35, 51)',
  ]);
  await host.controller.reload();
  expect(host.controller.state().assetSpans).toEqual([]);
});

it('keeps one show in flight and follows with the latest wanted frame', async () => {
  const host = setup();
  await host.controller.reload();
  const realm = host.realms[0];
  for (const frame of [5, 6, 7]) host.controller.seek(frame);
  expect(realm?.shows.map((show) => show.frame)).toEqual([0]);
  expect(host.controller.state().playhead).toBe(7);
  realm?.shows[0]?.answer();
  await flush();
  expect(realm?.shows.map((show) => show.frame)).toEqual([0, 7]);
  host.controller.seek(99);
  host.controller.seek(-3);
  realm?.shows[1]?.answer();
  await flush();
  expect(realm?.shows.map((show) => show.frame)).toEqual([0, 7, 0]);
});

it('plays from the audio clock at the preview rate and pauses at the last frame', async () => {
  const host = setup();
  await host.controller.reload();
  host.controller.seek(30);
  await host.controller.play();
  expect(host.controller.state().playback).toEqual({
    kind: 'playing',
    anchorFrame: 30,
    anchorTime: 100,
  });
  expect(host.started).toEqual([
    {
      clips: [
        { src: 'voice.wav', delay: 0, offset: 1, duration: 1, gain: 1 },
        { src: 'bad.wav', delay: 0, offset: 1, duration: 1, gain: 1 },
      ],
      muted: new Set(['voice.wav']),
    },
  ]);
  host.advance(0.5);
  expect(host.controller.state().playhead).toBe(45);
  host.advance(5);
  expect(host.controller.state()).toMatchObject({
    playhead: 59,
    playback: { kind: 'paused', frame: 59 },
  });
  expect(host.ticking()).toBe(false);
  await host.controller.play();
  expect(host.controller.state().playback).toMatchObject({ kind: 'playing', anchorFrame: 0 });
});

it('holds the first frame until the audio it started is heard', async () => {
  const host = setup({ latency: 0.2 });
  await host.controller.reload();
  await host.controller.play();
  expect(host.controller.state().playback).toMatchObject({ anchorTime: 100.2 });
  host.advance(0.15);
  expect(host.controller.state().playhead).toBe(0);
  host.advance(0.1);
  expect(host.controller.state().playhead).toBe(1);
});

it('stays paused when the browser refuses to resume the audio clock the playhead follows', async () => {
  const host = setup({ resumeFails: true });
  await host.controller.reload();
  await host.controller.play();
  expect(host.controller.state().playback).toEqual({ kind: 'paused', frame: 0 });
  expect(host.started).toEqual([]);
  expect(host.ticking()).toBe(false);
});

it('re-anchors audio on a seek while playing and pauses on a step', async () => {
  const host = setup();
  await host.controller.reload();
  await host.controller.play();
  host.controller.seek(20);
  expect(host.started.map((start) => start.clips[0]?.offset)).toEqual([0, 20 / 30]);
  host.controller.step(1);
  expect(host.controller.state()).toMatchObject({
    playhead: 21,
    playback: { kind: 'paused', frame: 21 },
  });
  expect(host.ticking()).toBe(false);
});

it('persists mute toggles and applies them to the voices playing', async () => {
  const host = setup();
  await host.controller.reload();
  host.controller.toggleMute('voice.wav');
  host.controller.toggleMute('bad.wav');
  expect(host.saved).toEqual([new Set(), new Set(['bad.wav'])]);
  expect(host.events).toEqual(['unmute voice.wav', 'mute bad.wav']);
  expect(host.controller.state().muted).toEqual(new Set(['bad.wav']));
});

it('offers a choice among several Compositions and records the one chosen', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')] });
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'choosing',
    compositions: [{ id: 'a' }, { id: 'b' }],
  });
  await host.controller.choose('b');
  expect(host.chosen).toEqual(['b']);
  expect(host.controller.state().session).toMatchObject({ kind: 'ready', descriptor: { id: 'b' } });
});

it('mounts the only Composition again by listing, so renaming it does not strand the preview', async () => {
  const host = setup({ later: [clip('renamed')] });
  await host.controller.reload();
  await host.controller.reload();
  expect(host.realms[1]?.mounts).toEqual([{ compositionId: 'renamed', props: { title: 'hi' } }]);
  expect(host.controller.state().session).toMatchObject({
    kind: 'ready',
    descriptor: { id: 'renamed' },
  });
});

it('keeps the chosen Composition across a reload after its mount failed', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')] });
  await host.controller.reload();
  await host.controller.choose('broken');
  expect(host.controller.state().session).toMatchObject({ kind: 'failed' });
  await host.controller.reload();
  expect(host.realms[1]?.mounts).toEqual([{ compositionId: 'broken', props: { title: 'hi' } }]);
});

it('offers the registry again when the chosen Composition is no longer in it', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')], later: [clip('a'), clip('c')] });
  await host.controller.reload();
  await host.controller.choose('b');
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'choosing',
    compositions: [{ id: 'a' }, { id: 'c' }],
  });
});

it('settles a mount the next reload interrupted without rejecting', async () => {
  const host = setup({ holdFirstMount: true });
  const interrupted = host.controller.reload();
  await flush();
  await host.controller.reload();
  await expect(interrupted).resolves.toBeUndefined();
  expect(host.realms[0]?.closed()).toBe(true);
  expect(host.controller.state().session).toMatchObject({
    kind: 'ready',
    descriptor: { id: 'clip' },
  });
});

it('reports a failed mount as the session state', async () => {
  const host = setup({ compositionId: 'broken' });
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'failed',
    diagnostic: { code: 'render.page-error' },
  });
});

it('mounts what the registry has when the page query names a Composition it lacks', async () => {
  const host = setup({ compositionId: 'missing' });
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'ready',
    descriptor: { id: 'clip' },
  });
});

it('reconnects on reload, keeping the Composition and playhead but not the spans', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')], compositionId: 'b' });
  await host.controller.reload();
  host.realms[0]?.shows[0]?.answer();
  await flush();
  host.controller.seek(40);
  await host.controller.play();
  await host.controller.reload({ audio: true });
  expect(host.realms[0]?.closed()).toBe(true);
  // Only a reload for a changed audio file drops the decoded sources; a source save keeps them.
  expect(host.forgotten()).toBe(1);
  expect(host.realms[1]?.mounts).toEqual([{ compositionId: 'b', props: { title: 'hi' } }]);
  expect(host.controller.state()).toMatchObject({
    playhead: 40,
    playback: { kind: 'paused', frame: 40 },
    spans: [],
    shown: undefined,
  });
  // A late answer from the closed realm is ignored.
  host.realms[0]?.shows[1]?.answer();
  await flush();
  expect(host.controller.state().shown).toBeUndefined();
  expect(host.realms[1]?.shows.map((show) => show.frame)).toEqual([40]);
});

it('reports a realm that never announced itself instead of loading forever', async () => {
  const host = setup({ silent: true });
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'failed',
    diagnostic: {
      code: 'render.page-error',
      message: 'The composition page loaded, but the entry did not start.',
    },
  });
});

it('starts playback only after the audio is decoded, so no clip plays silent', async () => {
  let decoded: (unplayable: readonly string[]) => void = () => {};
  const host = setup({
    prepare: () =>
      new Promise((resolve) => {
        decoded = resolve;
      }),
  });
  void host.controller.reload();
  await flush();
  expect(host.controller.state().session).toMatchObject({ kind: 'ready' });
  const playing = host.controller.play();
  await flush();
  expect(host.controller.state().playback.kind).toBe('paused');
  expect(host.started).toEqual([]);
  decoded([]);
  await playing;
  expect(host.controller.state().playback.kind).toBe('playing');
  expect(host.started).toHaveLength(1);
});

it('keeps a pause made while the audio decodes, so playback does not start after it', async () => {
  let decoded: (unplayable: readonly string[]) => void = () => {};
  const host = setup({
    prepare: () =>
      new Promise((resolve) => {
        decoded = resolve;
      }),
  });
  void host.controller.reload();
  await flush();
  const playing = host.controller.play();
  await flush();
  expect(host.controller.state().starting).toBe(true);
  host.controller.pause();
  expect(host.controller.state().starting).toBe(false);
  decoded([]);
  await playing;
  expect(host.controller.state().playback.kind).toBe('paused');
  expect(host.started).toEqual([]);
});

it('keeps a frame step made while the audio decodes paused at the stepped frame', async () => {
  let decoded: (unplayable: readonly string[]) => void = () => {};
  const host = setup({
    prepare: () =>
      new Promise((resolve) => {
        decoded = resolve;
      }),
  });
  void host.controller.reload();
  await flush();
  const playing = host.controller.play();
  await flush();
  host.controller.step(1);
  decoded([]);
  await playing;
  expect(host.controller.state().playback).toEqual({ kind: 'paused', frame: 1 });
  expect(host.started).toEqual([]);
});

it('seeks to whole frames', async () => {
  const host = setup();
  await host.controller.reload();
  host.controller.seek(12.9);
  expect(host.controller.state()).toMatchObject({
    playhead: 12,
    playback: { kind: 'paused', frame: 12 },
  });
});

it('asks the mounted realm what element is at a point, and answers none without one', async () => {
  const host = setup();
  expect(await host.controller.inspect(1, 2)).toEqual({ ok: true, value: null });
  await host.controller.reload();
  expect(await host.controller.inspect(3, 4)).toMatchObject({
    ok: true,
    value: { box: { x: 3, y: 4 } },
  });
  host.realms[0]?.realm.close();
  expect(await host.controller.inspect(5, 6)).toEqual({ ok: true, value: null });
});

it('asks the mounted realm for its elements, and answers none without one', async () => {
  const host = setup();
  expect(await host.controller.describe()).toEqual({ ok: true, value: null });
  await host.controller.reload();
  expect(await host.controller.describe()).toEqual({
    ok: true,
    value: { nodes: [], truncated: true },
  });
  host.realms[0]?.realm.close();
  expect(await host.controller.describe()).toEqual({ ok: true, value: null });
});

/** Answer every show the scan realm asked for until it asks for no more. */
const answerScan = async (scanner: ReturnType<typeof fakeRealm> | undefined) => {
  let answered = 0;
  for (;;) {
    await flush();
    const pending = scanner?.shows.slice(answered) ?? [];
    if (pending.length === 0) return;
    for (const show of pending) show.answer();
    answered += pending.length;
  }
};

it('reads every frame in a scan realm, so the timeline knows the frames nobody played', async () => {
  const host = setup({ scanner: true });
  await host.controller.reload();
  const scanner = host.scanners[0];
  expect(scanner?.mounts).toEqual([{ compositionId: 'clip', props: { title: 'hi' } }]);
  expect(host.controller.state().scan).toEqual({ scanned: 0, total: 60 });
  await answerScan(scanner);
  expect(scanner?.shows.map((show) => show.frame)).toEqual(
    Array.from({ length: 60 }, (_, frame) => frame),
  );
  // The stage has not answered its first frame yet.
  expect(host.controller.state()).toMatchObject({
    shown: undefined,
    scan: { scanned: 60, total: 60 },
    spans: [
      { path: ['intro'], startFrame: 0, endFrame: 30 },
      { path: ['outro'], startFrame: 30, endFrame: 60 },
    ],
    assets: [
      { kind: 'font', source: '/inter.woff2', frame: 0 },
      { kind: 'image', source: '/photo.png', frame: 30 },
    ],
  });
  expect(
    host.controller
      .state()
      .assetSpans.map(({ group, start, end }) => `${group.label} [${start}, ${end})`),
  ).toEqual(['inter.woff2 [0, 60)', 'photo.png [30, 60)']);
});

it('keeps the earliest frame an asset was seen at, whichever realm saw it first', async () => {
  const host = setup({ scanner: true });
  await host.controller.reload();
  host.controller.seek(45);
  host.realms[0]?.shows[0]?.answer();
  await flush();
  host.realms[0]?.shows[1]?.answer();
  await flush();
  expect(host.controller.state().assets[1]).toMatchObject({ source: '/photo.png', frame: 45 });
  await answerScan(host.scanners[0]);
  expect(host.controller.state().assets[1]).toMatchObject({ source: '/photo.png', frame: 30 });
});

it('holds the scan while playback runs or waits for its audio, and goes on after a pause', async () => {
  const host = setup({ scanner: true });
  await host.controller.reload();
  const scanner = host.scanners[0];
  await host.controller.play();
  await flush();
  expect(host.controller.state().playback.kind).toBe('playing');
  await answerScan(scanner);
  // The frame asked for before playback started is the only one.
  expect(scanner?.shows.map((show) => show.frame)).toEqual([0]);
  expect(host.controller.state().scan).toEqual({ scanned: 1, total: 60 });
  host.controller.pause();
  await answerScan(scanner);
  expect(host.controller.state().scan).toEqual({ scanned: 60, total: 60 });
});

it('starts the scan again on reload and leaves it out when its realm cannot start', async () => {
  const host = setup({ scanner: true });
  await host.controller.reload();
  await host.controller.reload();
  expect(host.scanners[0]?.closed()).toBe(true);
  expect(host.scanners).toHaveLength(2);
  await answerScan(host.scanners[1]);
  expect(host.controller.state().scan).toEqual({ scanned: 60, total: 60 });
  host.controller.dispose();
  expect(host.scanners[1]?.closed()).toBe(true);

  const without = setup();
  await without.controller.reload();
  await flush();
  expect(without.controller.state().scan).toBeUndefined();
});
