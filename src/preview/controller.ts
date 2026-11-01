import { createFrameRate, type FrameRate } from '../core/timeline/time.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import {
  type ElementTree,
  type InspectedElement,
  type RegisteredAsset,
  type ShowOutcome,
} from '../lib/preview-protocol.ts';
import { type Result } from '../lib/result.ts';
import { observeAssetFrames, type AssetFrame, type AssetSpan } from './asset-usage.ts';
import { type AudioPlayer } from './audio.ts';
import { type Realm } from './connection.ts';
import { type PreviewQuery } from './query.ts';
import { scanFrames, type ScanProgress } from './scan.ts';
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

/**
 * A registered asset as the frames shown or scanned so far report it. The scan stands in for the
 * assets instead of loading them, so one only the scan has seen is `unchecked`.
 */
export type SeenAsset = Readonly<{
  kind: RegisteredAsset['kind'];
  source: string;
  status: RegisteredAsset['status'] | 'unchecked';
  /** The earliest frame seen to use it, by the stage or the scan. */
  frame: number;
}>;

export type PreviewState = Readonly<{
  session: Session;
  playback: Playback;
  /** A play is waiting for the audio to decode; a pause or step withdraws it. */
  starting: boolean;
  /** The frame the playhead is on; the realm may still be showing an earlier one. */
  playhead: number;
  /** The realm's answer to the latest `show`. */
  shown: ShowOutcome | undefined;
  /** Every named Sequence span reported since the last reload, in first-seen order. */
  spans: readonly SequenceSpan[];
  /** Every font and image a shown or failed frame reported since the last reload, in first-seen order, with its latest status. */
  assets: readonly SeenAsset[];
  /** The frames that used each asset group, from the frames shown or failed since the last reload. */
  assetSpans: readonly AssetSpan[];
  muted: ReadonlySet<string>;
  /** Declared audio sources that could not be fetched or decoded. */
  unplayable: readonly string[];
  /** How far the scan realm read the mounted Composition; none runs while this is undefined. */
  scan: ScanProgress | undefined;
}>;

export type PreviewDependencies = Readonly<{
  query: PreviewQuery;
  /**
   * Load (or reload) the realm frame and connect to it. Rejects without `signal` aborting when the
   * frame's shell reports that the entry failed to load or run.
   */
  connect: (signal: AbortSignal) => Promise<Realm>;
  /**
   * Load (or reload) a second, hidden realm frame, a dry realm (core), and connect to it; it shows
   * every frame of the mounted Composition in turn, so the timeline knows the frames nobody played.
   * Closing that realm unloads its page, and the React tree it holds with it.
   */
  connectScanner: (signal: AbortSignal) => Promise<Realm>;
  audio: AudioPlayer;
  /**
   * The `AudioContext` clock in seconds; `latency` is how long a sound started now takes to be
   * heard, and `resume` must run inside a user gesture.
   */
  clock: Readonly<{ now: () => number; latency: () => number; resume: () => Promise<void> }>;
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
  /**
   * Connect on startup and again after every source change; `audio` says an audio file changed, so
   * the decoded sources are dropped. A save that changed only modules keeps them.
   */
  reload: (changed?: Readonly<{ audio: boolean }>) => Promise<void>;
  choose: (compositionId: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (frame: number) => void;
  step: (delta: number) => void;
  toggleMute: (src: string) => void;
  /** The element at a design-pixel point of the mounted Composition; none while nothing is mounted. */
  inspect: (x: number, y: number) => Promise<Result<InspectedElement | null>>;
  /** Every element of the shown frame; none while nothing is mounted. */
  describe: () => Promise<Result<ElementTree | null>>;
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
const assetKey = ({ kind, source }: Pick<RegisteredAsset, 'kind' | 'source'>) =>
  `${kind}\0${source}`;
/** One answered frame; `continued` as for `observeAssetFrames`. */
type Observation = Readonly<{
  frame: number;
  outcome: ShowOutcome;
  continued?: number | undefined;
}>;
/**
 * What the answers of frames, in order, add to the state. A frame the stage showed (`checked`)
 * sets the status of each asset it used; a scanned one adds the assets not seen before, unchecked.
 */
const observe = (
  state: PreviewState,
  observations: readonly Observation[],
  checked: boolean,
): Pick<PreviewState, 'spans' | 'assets' | 'assetSpans'> => {
  let { spans } = state;
  const assets = new Map(state.assets.map((asset) => [assetKey(asset), asset]));
  const frames: AssetFrame[] = [];
  for (const { frame, outcome, continued } of observations) {
    if (outcome.status === 'shown') spans = accumulate(spans, outcome.sequences);
    if (outcome.status === 'aborted') continue;
    frames.push({ frame, assets: outcome.assets, continued });
    for (const { kind, source, status } of outcome.assets) {
      const known = assets.get(assetKey({ kind, source }));
      assets.set(
        assetKey({ kind, source }),
        known === undefined
          ? { kind, source, status: checked ? status : 'unchecked', frame }
          : {
              ...known,
              status: checked ? status : known.status,
              frame: Math.min(known.frame, frame),
            },
      );
    }
  }
  return {
    spans,
    assets: frames.length === 0 ? state.assets : [...assets.values()],
    assetSpans: observeAssetFrames(state.assetSpans, frames),
  };
};
// The scan reports this many frames at once, so the lanes are not packed again for every frame.
const scanBatch = 30;
const lastFrame = (descriptor: LoadingDescriptor) => Math.max(descriptor.durationInFrames - 1, 0);
const realmDidNotStart: Diagnostic = {
  code: 'render.page-error',
  severity: 'error',
  message: 'The composition page loaded, but the entry did not start.',
  hint: 'Read the error in the browser console or the terminal running motion-kit preview, then save a fix; the preview reloads on its own.',
};

/** The preview host's state and the realm, audio and timer it drives; the view only renders it. */
export const createPreviewController = (deps: PreviewDependencies): PreviewController => {
  let state: PreviewState = {
    session: { kind: 'connecting' },
    playback: { kind: 'paused', frame: 0 },
    starting: false,
    playhead: 0,
    shown: undefined,
    spans: [],
    assets: [],
    assetSpans: [],
    muted: deps.muted.load(),
    unplayable: [],
    scan: undefined,
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<PreviewState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
    wakeScan();
  };
  let realm: Realm | undefined;
  let connection: AbortController | undefined;
  let presenter: Presenter = idlePresenter;
  let stopTicking: (() => void) | undefined;
  // Only an id the page query or the chooser named; the only Composition is found by listing on
  // every reload, so a save that renames it does not leave the preview mounting a stale id.
  let compositionId = deps.query.compositionId;
  // Playback waits for the mounted Composition's audio, so no clip starts before it is decoded.
  let prepared: Promise<void> = Promise.resolve();
  // The play waiting for that audio, so a later play, pause, step or reload supersedes it.
  let starting: object | undefined;
  const withdraw = () => {
    starting = undefined;
    if (state.starting) update({ starting: false });
  };

  // Each play, and each seek while playing, starts a run; the frames one run shows follow each
  // other, so the asset spans bridge the frames playback skipped between them.
  let playRun: object = {};
  let lastShown: Readonly<{ run: object | undefined; frame: number }> | undefined;
  const present = (frame: number | undefined) => {
    if (frame === undefined || realm === undefined) return;
    const current = realm;
    const sentIn = playing() ? playRun : undefined;
    current.show(frame).then(
      (outcome) => {
        if (current !== realm) return;
        const continued =
          sentIn !== undefined && lastShown?.run === sentIn ? lastShown.frame : undefined;
        if (outcome.status !== 'aborted') lastShown = { run: sentIn, frame };
        update({ shown: outcome, ...observe(state, [{ frame, outcome, continued }], true) });
        const step = frameAnswered(presenter);
        presenter = step.state;
        present(step.send);
        wakeScan();
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
  const playing = () => state.playback.kind === 'playing';

  // The scan waits while playback runs or is about to, and while the stage is showing a frame, so
  // it does not take the time of the frames on screen.
  let waking: (() => void)[] = [];
  const scanMayRun = () => !playing() && !state.starting && presenter.inFlight === undefined;
  const wakeScan = () => {
    if (waking.length > 0 && scanMayRun()) for (const wake of waking.splice(0)) wake();
  };
  let scanning: AbortController | undefined;
  let scanner: Realm | undefined;
  const stopScan = () => {
    scanning?.abort();
    scanning = undefined;
    scanner?.close();
    scanner = undefined;
    for (const wake of waking.splice(0)) wake();
  };
  const scan = async (descriptor: LoadingDescriptor) => {
    stopScan();
    const controller = new AbortController();
    scanning = controller;
    const total = descriptor.durationInFrames;
    update({ scan: { scanned: 0, total } });
    // A scan that cannot start leaves the timeline to the frames shown, as before there was one.
    const giveUp = () => {
      if (controller.signal.aborted) return;
      stopScan();
      update({ scan: undefined });
    };
    let current: Realm;
    try {
      current = await deps.connectScanner(controller.signal);
    } catch {
      giveUp();
      return;
    }
    if (controller.signal.aborted) {
      current.close();
      return;
    }
    scanner = current;
    const mounted = await unlessClosed(current.mount(descriptor.id, deps.query.props));
    if (mounted?.ok !== true || mounted.value.descriptor.durationInFrames !== total) {
      giveUp();
      return;
    }
    await scanFrames({
      show: (frame) => current.show(frame),
      total,
      idle: scanMayRun,
      wake: () =>
        new Promise((resolve) => {
          waking.push(resolve);
        }),
      report: (steps, progress) => update({ scan: progress, ...observe(state, steps, false) }),
      batch: scanBatch,
      signal: controller.signal,
    });
    // Every frame read: the realm is no longer needed.
    if (scanning === controller) {
      scanning = undefined;
      scanner?.close();
      scanner = undefined;
    }
  };

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
    // The playhead leaves the anchor when the clips started here are heard, not when they start.
    const playback: Playback = {
      kind: 'playing',
      anchorFrame,
      anchorTime: deps.clock.now() + deps.clock.latency(),
    };
    playRun = {};
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

  // A request rejects only when its realm closed for a reload, whose successor takes over.
  const unlessClosed = <T>(request: Promise<T>): Promise<T | undefined> =>
    request.catch(() => undefined);

  const mount = async (current: Realm, id: string | undefined) => {
    const mounted = await unlessClosed(current.mount(id, deps.query.props));
    if (mounted === undefined || current !== realm) return;
    if (!mounted.ok) {
      // A remembered id a save renamed away: offer what the registry has now, not a dead end.
      if (mounted.error.code === 'cli.composition-not-found' && id === compositionId) {
        compositionId = undefined;
        return offer(current);
      }
      update({ session: { kind: 'failed', diagnostic: mounted.error } });
      return;
    }
    const { descriptor } = mounted.value;
    const fps = createFrameRate(descriptor.fps);
    if (!fps.ok) {
      update({ session: { kind: 'failed', diagnostic: fps.error } });
      return;
    }
    update({ session: { kind: 'ready', descriptor, fps: fps.value } });
    want(Math.min(state.playhead, lastFrame(descriptor)));
    void scan(descriptor);
    prepared = deps.audio
      .prepare((descriptor.audio ?? []).map((track) => track.src))
      .then((unplayable) => {
        if (current === realm) update({ unplayable });
      });
    await prepared;
  };

  // Mount a registry of one; show a larger one as a chooser.
  const offer = async (current: Realm): Promise<void> => {
    const listed = await unlessClosed(current.list());
    if (listed === undefined || current !== realm) return;
    if (!listed.ok) update({ session: { kind: 'failed', diagnostic: listed.error } });
    else if (listed.value.length === 1) await mount(current, listed.value[0]?.id);
    else update({ session: { kind: 'choosing', compositions: listed.value } });
  };

  const reload = async (changed: Readonly<{ audio: boolean }> = { audio: false }) => {
    if (state.playback.kind === 'playing') pause();
    withdraw();
    connection?.abort();
    realm?.close();
    realm = undefined;
    stopScan();
    presenter = idlePresenter;
    prepared = Promise.resolve();
    if (changed.audio) deps.audio.forget();
    const controller = new AbortController();
    connection = controller;
    update({
      session: { kind: 'connecting' },
      shown: undefined,
      spans: [],
      assets: [],
      assetSpans: [],
      scan: undefined,
    });
    let current: Realm;
    try {
      current = await deps.connect(controller.signal);
    } catch {
      if (!controller.signal.aborted)
        update({ session: { kind: 'failed', diagnostic: realmDidNotStart } });
      return;
    }
    if (controller.signal.aborted) {
      current.close();
      return;
    }
    realm = current;
    if (compositionId !== undefined) return mount(current, compositionId);
    return offer(current);
  };

  const seek = (frame: number) => {
    const session = ready();
    if (session === undefined) return;
    const target = Math.min(Math.max(Math.floor(frame), 0), lastFrame(session.descriptor));
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
      // Remembered before mounting, so a reload while fixing a failed mount keeps the choice.
      compositionId = id;
      update({ session: { kind: 'connecting' } });
      await mount(current, id);
    },
    play: async () => {
      const session = ready();
      if (session === undefined || state.playback.kind === 'playing') return;
      const request = {};
      starting = request;
      update({ starting: true });
      const [resumed] = await Promise.all([
        deps.clock.resume().then(
          () => true,
          () => false,
        ),
        prepared,
      ]);
      // The audio clock is the playhead, so a clock the browser refuses to resume cannot play.
      // A pause, step, reload or another play may have happened while the audio was decoding.
      if (starting !== request) return;
      withdraw();
      if (!resumed || ready() !== session || playing()) return;
      run(state.playhead >= lastFrame(session.descriptor) ? 0 : state.playhead);
    },
    pause: () => {
      withdraw();
      if (state.playback.kind === 'playing') pause();
    },
    seek,
    step: (delta) => {
      withdraw();
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
    inspect: async (x, y) => {
      const current = realm;
      if (current === undefined || ready() === undefined) return { ok: true, value: null };
      return (await unlessClosed(current.inspect(x, y))) ?? { ok: true, value: null };
    },
    describe: async () => {
      const current = realm;
      if (current === undefined || ready() === undefined) return { ok: true, value: null };
      return (await unlessClosed(current.describe())) ?? { ok: true, value: null };
    },
    dispose: () => {
      halt();
      stopScan();
      connection?.abort();
      realm?.close();
      realm = undefined;
      listeners.clear();
    },
  };
};
