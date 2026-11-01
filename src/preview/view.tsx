import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { activeSequences } from '../core/sequence/directory.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { packLanes, timecode } from './schedule.ts';

const styles = `
:root { color-scheme: dark; font: 13px/1.4 system-ui, sans-serif; }
body { margin: 0; background: #111; color: #ddd; }
.mk-host { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100vh; }
.mk-stage { position: relative; overflow: hidden; display: grid; place-items: center; background: #000; }
.mk-frame { border: 0; transform-origin: center; background: #000; pointer-events: none; }
.mk-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: #111d; padding: 24px; }
.mk-panel { max-width: 640px; }
.mk-panel h2 { margin: 0 0 8px; font-size: 15px; }
.mk-panel code, .mk-diagnostic code { color: #f99; }
.mk-panel button { margin: 4px 4px 0 0; }
.mk-dock { border-top: 1px solid #333; padding: 8px 12px; display: grid; gap: 6px; max-height: 40vh; overflow-y: auto; }
.mk-controls { display: flex; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
.mk-controls input[type=range] { flex: 1; }
.mk-lag { color: #fc6; }
.mk-diagnostic { color: #f99; white-space: pre-wrap; }
.mk-timeline { position: relative; display: grid; gap: 2px; cursor: pointer; user-select: none; }
.mk-row { position: relative; height: 16px; }
.mk-bar { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: #345; color: #ccd; font-size: 11px; padding: 0 4px; overflow: hidden; white-space: nowrap; }
.mk-bar.mk-active { background: #48c; color: #fff; }
.mk-bar.mk-audio { background: #354; }
.mk-bar.mk-muted { opacity: .4; }
.mk-bar.mk-unplayable { background: #633; }
.mk-playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: #f55; pointer-events: none; }
.mk-tracks { display: flex; flex-wrap: wrap; gap: 6px; }
`;

const DiagnosticText = ({ diagnostic }: { diagnostic: Diagnostic }) => (
  <div className="mk-diagnostic">
    <code>{diagnostic.code}</code> {diagnostic.message}
    {'\n'}
    {diagnostic.hint}
  </div>
);

const basename = (src: string) => src.slice(src.lastIndexOf('/') + 1);
const percent = (frame: number, duration: number) =>
  `${(Math.min(Math.max(frame, 0), duration) / Math.max(duration, 1)) * 100}%`;
const same = (a: SequenceSpan, b: SequenceSpan) =>
  a.startFrame === b.startFrame &&
  a.endFrame === b.endFrame &&
  a.path.join('\0') === b.path.join('\0');

const Timeline = ({
  state,
  descriptor,
  controller,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  controller: PreviewController;
}) => {
  const duration = descriptor.durationInFrames;
  // A named Sequence is reported while its parent is mounted, so the shown frame picks the active.
  const active =
    state.shown?.status === 'shown'
      ? activeSequences(state.shown.sequences, state.shown.frame)
      : [];
  // A span past the Composition is clipped to it; one that is empty there is not drawn.
  // Spans that never overlap share a row, as audio clips do, so many Sequences stay in the dock.
  const spanLanes = packLanes(
    state.spans
      .map((span) => ({
        span,
        start: Math.max(span.startFrame, 0),
        end: Math.min(span.endFrame, duration),
      }))
      .filter((item) => item.start < item.end),
  );
  // Audio clips past the Composition are clipped the same way; ones that never overlap share a lane.
  const clips = (descriptor.audio ?? [])
    .map((track, index) => ({
      track,
      index,
      start: Math.max(track.startInFrames ?? 0, 0),
      end: Math.min(track.endInFrames ?? duration, duration),
    }))
    .filter((clip) => clip.start < clip.end);
  const audioLanes = packLanes(clips);
  const seek = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    controller.seek(Math.floor(((event.clientX - box.left) / box.width) * duration));
  };
  return (
    <div className="mk-timeline" onClick={seek}>
      {spanLanes.map((lane, laneIndex) => (
        <div className="mk-row" key={`span:${laneIndex}`}>
          {lane.map(({ span }) => (
            <div
              key={`${span.path.join('\0')}:${span.startFrame}:${span.endFrame}`}
              className={`mk-bar${active.some((item) => same(item, span)) ? ' mk-active' : ''}`}
              style={{
                left: percent(span.startFrame, duration),
                right: `calc(100% - ${percent(span.endFrame, duration)})`,
              }}
              title={`${span.path.join(' › ')} [${span.startFrame}, ${span.endFrame})`}
            >
              {span.path.join(' › ')}
            </div>
          ))}
        </div>
      ))}
      {audioLanes.map((lane, laneIndex) => (
        <div className="mk-row" key={`audio:${laneIndex}`}>
          {lane.map(({ track, start, end, index }) => (
            <div
              key={index}
              className={`mk-bar mk-audio${state.muted.has(track.src) ? ' mk-muted' : ''}${state.unplayable.includes(track.src) ? ' mk-unplayable' : ''}`}
              style={{
                left: percent(start, duration),
                right: `calc(100% - ${percent(end, duration)})`,
              }}
              title={track.src}
            >
              ♪ {basename(track.src)}
            </div>
          ))}
        </div>
      ))}
      <div className="mk-playhead" style={{ left: percent(state.playhead, duration) }} />
    </div>
  );
};

/** Fit the Composition's pixel size into the stage without upscaling. */
const useFit = (width: number, height: number) => {
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const fit = () =>
      setScale(Math.min(element.clientWidth / width, element.clientHeight / height, 1));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  return { stage, scale };
};

const Controls = ({
  state,
  descriptor,
  controller,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  controller: PreviewController;
}) => {
  const fps = state.session.kind === 'ready' ? state.session.fps : undefined;
  const last = Math.max(descriptor.durationInFrames - 1, 0);
  const shownFrame = state.shown?.status === 'shown' ? state.shown.frame : undefined;
  // A play waiting for its audio already shows pause, so a second press withdraws it.
  const digits = String(last).length;
  // Playback is a frame or two behind on every tick; only half a second behind is worth showing.
  const tolerated =
    state.playback.kind === 'playing'
      ? descriptor.fps.numerator / descriptor.fps.denominator / 2
      : 0;
  const lagging = shownFrame !== undefined && Math.abs(state.playhead - shownFrame) > tolerated;
  const playing = state.playback.kind === 'playing' || state.starting;
  return (
    <div className="mk-controls">
      <button type="button" onClick={() => controller.step(-1)} title="Previous frame (←)">
        ⏮
      </button>
      <button
        type="button"
        onClick={() => (playing ? controller.pause() : void controller.play())}
        title="Play / pause (Space)"
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" onClick={() => controller.step(1)} title="Next frame (→)">
        ⏭
      </button>
      <input
        type="range"
        min={0}
        max={last}
        value={state.playhead}
        onChange={(event) => controller.seek(Number(event.currentTarget.value))}
      />
      <span>
        {fps === undefined
          ? ''
          : `${timecode(state.playhead, fps)} / ${timecode(descriptor.durationInFrames, fps)}`}
      </span>
      <span style={{ minWidth: `${2 * digits + 9}ch` }}>
        frame {state.playhead} / {last}
      </span>
      {/* Always laid out, so the scrubber does not resize as the lag comes and goes. */}
      <span
        className="mk-lag"
        style={{ minWidth: `${digits + 8}ch`, visibility: lagging ? 'visible' : 'hidden' }}
        title="The realm is still rendering the playhead"
      >
        showing {shownFrame ?? state.playhead}
      </span>
    </div>
  );
};

const panel = (children: ReactNode) => (
  <div className="mk-overlay">
    <div className="mk-panel">{children}</div>
  </div>
);

const Overlay = ({ state, controller }: { state: PreviewState; controller: PreviewController }) => {
  const { session } = state;
  if (session.kind === 'ready') return undefined;
  if (session.kind === 'connecting') return panel('Loading…');
  if (session.kind === 'failed')
    return panel(
      <>
        <h2>The Composition could not be loaded</h2>
        <DiagnosticText diagnostic={session.diagnostic} />
      </>,
    );
  return panel(
    <>
      <h2>Choose a Composition</h2>
      {session.compositions.map((composition) => (
        <button
          type="button"
          key={composition.id}
          onClick={() => void controller.choose(composition.id)}
        >
          {composition.id} ({composition.width}×{composition.height}, {composition.durationInFrames}{' '}
          frames)
        </button>
      ))}
    </>,
  );
};

/**
 * The keys a focused control acts on itself, which the shortcuts then leave alone: a text field
 * takes every key, and Space activates a button or toggles a checkbox. Focus stays on the scrubber
 * or a checkbox after it is used, so the other keys still reach the shortcuts.
 */
const nativeKeys = (target: EventTarget | null): 'all' | 'space' | 'none' => {
  if (target instanceof HTMLButtonElement) return 'space';
  if (!(target instanceof HTMLInputElement)) return 'none';
  if (target.type === 'range') return 'none';
  return target.type === 'checkbox' ? 'space' : 'all';
};

/** The preview host page. The realm iframe is the only element React does not own the contents of. */
export const PreviewView = ({
  controller,
  frame,
}: {
  controller: PreviewController;
  frame: (element: HTMLIFrameElement | null) => void;
}) => {
  const state = useSyncExternalStore(controller.subscribe, controller.state);
  const descriptor = state.session.kind === 'ready' ? state.session.descriptor : undefined;
  const { stage, scale } = useFit(descriptor?.width ?? 1280, descriptor?.height ?? 720);
  useEffect(() => {
    void controller.reload();
    return () => controller.dispose();
  }, [controller]);
  // Shortcuts work wherever focus is on the page; the realm frame takes neither pointer input
  // (see .mk-frame) nor focus (tabIndex), so its keys never go to the realm.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A modified key belongs to the browser: Alt+Arrow navigates history, Ctrl+Space is the IME.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const keys = nativeKeys(event.target);
      if (keys === 'all' || (keys === 'space' && event.key === ' ')) return;
      const delta = event.shiftKey ? 10 : 1;
      if (event.key === ' ') {
        event.preventDefault();
        // A held Space would toggle playback on every repeat.
        if (event.repeat) return;
        const current = controller.state();
        if (current.playback.kind === 'playing' || current.starting) controller.pause();
        else void controller.play();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // A focused scrubber would move by itself as well, and the page would scroll.
        event.preventDefault();
        controller.step(event.key === 'ArrowLeft' ? -delta : delta);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
  return (
    <div className="mk-host">
      <style>{styles}</style>
      <div className="mk-stage" ref={stage}>
        <iframe
          ref={frame}
          className="mk-frame"
          title="Composition"
          tabIndex={-1}
          width={descriptor?.width ?? 1280}
          height={descriptor?.height ?? 720}
          style={{ transform: `scale(${scale})`, position: 'absolute' }}
        />
        <Overlay state={state} controller={controller} />
      </div>
      {descriptor === undefined ? undefined : (
        <div className="mk-dock">
          <Controls state={state} descriptor={descriptor} controller={controller} />
          {state.shown?.status === 'failed'
            ? state.shown.diagnostics.map((diagnostic, index) => (
                <DiagnosticText key={index} diagnostic={diagnostic} />
              ))
            : undefined}
          <Timeline state={state} descriptor={descriptor} controller={controller} />
          {(descriptor.audio ?? []).length === 0 ? undefined : (
            <div className="mk-tracks">
              {[...new Set((descriptor.audio ?? []).map((track) => track.src))].map((src) => (
                <label
                  key={src}
                  title={state.unplayable.includes(src) ? 'Could not be decoded' : src}
                >
                  <input
                    type="checkbox"
                    checked={!state.muted.has(src)}
                    onChange={() => controller.toggleMute(src)}
                  />{' '}
                  {src}
                  {state.unplayable.includes(src) ? ' (unplayable)' : ''}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
