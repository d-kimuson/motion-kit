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
              },
            ),
        });
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
    compositionId?: string;
    /** The realm frame loads but never announces itself. */
    silent?: boolean;
    prepare?: AudioPlayer['prepare'];
    /** The first realm's mount stays pending until that realm closes. */
    holdFirstMount?: boolean;
  } = {},
) => {
  const realms: ReturnType<typeof fakeRealm>[] = [];
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
        options.compositions ?? [clip('clip', [{ src: 'voice.wav' }, { src: 'bad.wav' }])],
        options.holdFirstMount === true && realms.length === 0,
      );
      realms.push(realm);
      return Promise.resolve(realm.realm);
    },
    audio,
    clock: { now: () => now, resume: () => Promise.resolve() },
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

it('keeps the chosen Composition across a reload after its mount failed', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')] });
  await host.controller.reload();
  await host.controller.choose('gone');
  expect(host.controller.state().session).toMatchObject({ kind: 'failed' });
  await host.controller.reload();
  expect(host.realms[1]?.mounts).toEqual([{ compositionId: 'gone', props: { title: 'hi' } }]);
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
  const host = setup({ compositionId: 'missing' });
  await host.controller.reload();
  expect(host.controller.state().session).toMatchObject({
    kind: 'failed',
    diagnostic: { code: 'cli.composition-not-found' },
  });
});

it('reconnects on reload, keeping the Composition and playhead but not the spans', async () => {
  const host = setup({ compositions: [clip('a'), clip('b')], compositionId: 'b' });
  await host.controller.reload();
  host.realms[0]?.shows[0]?.answer();
  await flush();
  host.controller.seek(40);
  await host.controller.play();
  await host.controller.reload();
  expect(host.realms[0]?.closed()).toBe(true);
  // The audio files may be what changed, so each reload decodes them again.
  expect(host.forgotten()).toBe(2);
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

it('seeks to whole frames', async () => {
  const host = setup();
  await host.controller.reload();
  host.controller.seek(12.9);
  expect(host.controller.state()).toMatchObject({
    playhead: 12,
    playback: { kind: 'paused', frame: 12 },
  });
});
