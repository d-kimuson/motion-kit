import { createFrameRate, type FrameRate } from '../core/timeline/time.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import { type ShowOutcome } from '../lib/preview-protocol.ts';
import { type AudioPlayer } from './audio.ts';
import { type Realm } from './connection.ts';
import { type PreviewQuery } from './query.ts';
import {
  audioSchedule,
  frameAnswered,
  idlePresenter,
  playheadFrame,
  wantFrame,
  type Playback,
  type Presenter,
} from './schedule.ts';

/** Where the host is with its realm; only `ready` has a Composition to play. */
export type Session =
  | Readonly<{ kind: 'connecting' }>
  | Readonly<{ kind: 'choosing'; compositions: readonly LoadingDescriptor[] }>
  | Readonly<{ kind: 'failed'; diagnostic: Diagnostic }>
  | Readonly<{ kind: 'ready'; descriptor: LoadingDescriptor; fps: FrameRate }>;

export type PreviewState = Readonly<{
  session: Session;
  playback: Playback;
  /** The frame the playhead is on; the realm may still be showing an earlier one. */
  playhead: number;
  /** The realm's answer to the latest `show`. */
  shown: ShowOutcome | undefined;
  /** Every named Sequence span reported since the last reload, in first-seen order. */
  spans: readonly SequenceSpan[];
  muted: ReadonlySet<string>;
  /** Declared audio sources that could not be fetched or decoded. */
  unplayable: readonly string[];
}>;

export type PreviewDependencies = Readonly<{
  query: PreviewQuery;
  /** Load (or reload) the realm frame and connect to it. */
  connect: (signal: AbortSignal) => Promise<Realm>;
  audio: AudioPlayer;
  /** The `AudioContext` clock in seconds; `resume` must run inside a user gesture. */
  clock: Readonly<{ now: () => number; resume: () => Promise<void> }>;
  interval: Readonly<{
    start: (tick: () => void, ms: number) => () => void;
  }>;
  muted: Readonly<{ load: () => ReadonlySet<string>; save: (muted: ReadonlySet<string>) => void }>;
  /** Record the chosen Composition in the page query, so a page reload keeps it. */
  choose: (compositionId: string) => void;
}>;

export type PreviewController = Readonly<{
  state: () => PreviewState;
  subscribe: (listener: () => void) => () => void;
  /** Connect on startup and again after every source change. */
  reload: () => Promise<void>;
  choose: (compositionId: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (frame: number) => void;
  step: (delta: number) => void;
  toggleMute: (src: string) => void;
  dispose: () => void;
}>;

const sameSpan = (a: SequenceSpan, b: SequenceSpan) =>
  a.startFrame === b.startFrame &&
  a.endFrame === b.endFrame &&
  a.path.length === b.path.length &&
  a.path.every((name, index) => name === b.path[index]);
const accumulate = (spans: readonly SequenceSpan[], seen: readonly SequenceSpan[]) => [
  ...spans,
  ...seen.filter((span) => !spans.some((known) => sameSpan(known, span))),
];
const lastFrame = (descriptor: LoadingDescriptor) => Math.max(descriptor.durationInFrames - 1, 0);

/** The preview host's state and the realm, audio and timer it drives; the view only renders it. */
export const createPreviewController = (deps: PreviewDependencies): PreviewController => {
  let state: PreviewState = {
    session: { kind: 'connecting' },
    playback: { kind: 'paused', frame: 0 },
    playhead: 0,
    shown: undefined,
    spans: [],
    muted: deps.muted.load(),
    unplayable: [],
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<PreviewState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  let realm: Realm | undefined;
  let connection: AbortController | undefined;
  let presenter: Presenter = idlePresenter;
  let stopTicking: (() => void) | undefined;
  let compositionId = deps.query.compositionId;

  const present = (frame: number | undefined) => {
    if (frame === undefined || realm === undefined) return;
    const current = realm;
    current.show(frame).then(
      (outcome) => {
        if (current !== realm) return;
        update({
          shown: outcome,
          ...(outcome.status === 'shown'
            ? { spans: accumulate(state.spans, outcome.sequences) }
            : {}),
        });
        const step = frameAnswered(presenter);
        presenter = step.state;
        present(step.send);
      },
      // The realm closed for a reload; its successor shows the playhead again.
      () => {},
    );
  };
  const want = (frame: number) => {
    update({ playhead: frame });
    const step = wantFrame(presenter, frame);
    presenter = step.state;
    present(step.send);
  };
  const ready = () => (state.session.kind === 'ready' ? state.session : undefined);

  const halt = () => {
    stopTicking?.();
    stopTicking = undefined;
    deps.audio.stop();
  };
  const pause = () => {
    halt();
    update({ playback: { kind: 'paused', frame: state.playhead } });
  };
  const run = (anchorFrame: number) => {
    const session = ready();
    if (session === undefined) return;
    halt();
    const playback: Playback = { kind: 'playing', anchorFrame, anchorTime: deps.clock.now() };
    update({ playback });
    deps.audio.start(
      audioSchedule(
        session.descriptor.audio ?? [],
        anchorFrame,
        session.fps,
        session.descriptor.durationInFrames,
      ),
      state.muted,
    );
    want(anchorFrame);
    const end = lastFrame(session.descriptor);
    stopTicking = deps.interval.start(() => {
      const frame = playheadFrame(
        playback,
        deps.clock.now(),
        session.fps,
        session.descriptor.durationInFrames,
      );
      if (frame !== state.playhead) want(frame);
      if (frame >= end) pause();
    }, 1000 / deps.query.fps);
  };

  const mount = async (current: Realm, id: string | undefined) => {
    const mounted = await current.mount(id, deps.query.props);
    if (current !== realm) return;
    if (!mounted.ok) {
      update({ session: { kind: 'failed', diagnostic: mounted.error } });
      return;
    }
    const { descriptor } = mounted.value;
    const fps = createFrameRate(descriptor.fps);
    if (!fps.ok) {
      update({ session: { kind: 'failed', diagnostic: fps.error } });
      return;
    }
    compositionId = descriptor.id;
    update({ session: { kind: 'ready', descriptor, fps: fps.value } });
    want(Math.min(state.playhead, lastFrame(descriptor)));
    const unplayable = await deps.audio.prepare((descriptor.audio ?? []).map((track) => track.src));
    if (current === realm) update({ unplayable });
  };

  const reload = async () => {
    if (state.playback.kind === 'playing') pause();
    connection?.abort();
    realm?.close();
    realm = undefined;
    presenter = idlePresenter;
    const controller = new AbortController();
    connection = controller;
    update({ session: { kind: 'connecting' }, shown: undefined, spans: [] });
    let current: Realm;
    try {
      current = await deps.connect(controller.signal);
    } catch {
      return;
    }
    if (controller.signal.aborted) {
      current.close();
      return;
    }
    realm = current;
    if (compositionId !== undefined) return mount(current, compositionId);
    const listed = await current.list();
    if (current !== realm) return;
    if (!listed.ok) update({ session: { kind: 'failed', diagnostic: listed.error } });
    else if (listed.value.length === 1) await mount(current, listed.value[0]?.id);
    else update({ session: { kind: 'choosing', compositions: listed.value } });
  };

  const seek = (frame: number) => {
    const session = ready();
    if (session === undefined) return;
    const target = Math.min(Math.max(Math.round(frame), 0), lastFrame(session.descriptor));
    if (state.playback.kind === 'playing') run(target);
    else {
      update({ playback: { kind: 'paused', frame: target } });
      want(target);
    }
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload,
    choose: async (id) => {
      const current = realm;
      if (current === undefined || state.session.kind !== 'choosing') return;
      deps.choose(id);
      update({ session: { kind: 'connecting' } });
      await mount(current, id);
    },
    play: async () => {
      const session = ready();
      if (session === undefined || state.playback.kind === 'playing') return;
      await deps.clock.resume();
      run(state.playhead >= lastFrame(session.descriptor) ? 0 : state.playhead);
    },
    pause: () => {
      if (state.playback.kind === 'playing') pause();
    },
    seek,
    step: (delta) => {
      if (state.playback.kind === 'playing') pause();
      seek(state.playhead + delta);
    },
    toggleMute: (src) => {
      const muted = new Set(state.muted);
      const mute = !muted.delete(src);
      if (mute) muted.add(src);
      deps.muted.save(muted);
      deps.audio.setMuted(src, mute);
      update({ muted });
    },
    dispose: () => {
      halt();
      connection?.abort();
      realm?.close();
      realm = undefined;
      listeners.clear();
    },
  };
};
