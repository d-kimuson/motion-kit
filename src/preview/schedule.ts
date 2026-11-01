import {
  addTime,
  compareTime,
  createFrameRate,
  createTimelineTime,
  frameToTime,
  subtractTime,
  timeToFrameFloor,
  toSeconds,
  zeroTime,
  type FrameRate,
  type TimelineTime,
} from '../core/timeline/time.ts';
import { type AudioTrack } from '../lib/loading-protocol.ts';

/** Where the host's playhead is; while playing, the audio clock moves it. */
export type Playback =
  | Readonly<{ kind: 'paused'; frame: number }>
  | Readonly<{ kind: 'playing'; anchorFrame: number; anchorTime: number }>;

const clampFrame = (frame: number, durationInFrames: number) =>
  Math.min(Math.max(frame, 0), Math.max(durationInFrames - 1, 0));
const later = (a: TimelineTime, b: TimelineTime) => (compareTime(a, b) < 0 ? b : a);
const earlier = (a: TimelineTime, b: TimelineTime) => (compareTime(a, b) > 0 ? b : a);
const frameTime = (frame: number, fps: FrameRate) => frameToTime(BigInt(frame), fps);

/**
 * The frame the playhead is on. While playing, `audioTime` is the `AudioContext` clock in
 * seconds and the frame is the anchor plus the elapsed time, floored through the Time Module.
 */
export const playheadFrame = (
  playback: Playback,
  audioTime: number,
  fps: FrameRate,
  durationInFrames: number,
): number => {
  if (playback.kind === 'paused') return clampFrame(playback.frame, durationInFrames);
  // Before the anchor time the clips started at the anchor are not heard yet, so it holds.
  const elapsed = createTimelineTime(Math.max(audioTime - playback.anchorTime, 0));
  const advanced = elapsed.ok ? Number(timeToFrameFloor(elapsed.value, fps)) : 0;
  return clampFrame(playback.anchorFrame + advanced, durationInFrames);
};

/** One clip to start now: wait `delay` seconds, then play `duration` seconds from `offset`. */
export type ScheduledClip = Readonly<{
  src: string;
  delay: number;
  offset: number;
  duration: number;
  gain: number;
}>;

/**
 * The declared clips still audible from `fromFrame`, in declaration order. Every clip ends at the
 * Composition duration at the latest, as the encoder caps the muxed audio; a source that ends
 * sooner stops on its own.
 */
export const audioSchedule = (
  tracks: readonly AudioTrack[],
  fromFrame: number,
  fps: FrameRate,
  durationInFrames: number,
): readonly ScheduledClip[] => {
  const from = frameTime(fromFrame, fps);
  const composition = frameTime(durationInFrames, fps);
  return tracks.flatMap((track): ScheduledClip[] => {
    const start = frameTime(track.startInFrames ?? 0, fps);
    const end =
      track.endInFrames === undefined
        ? composition
        : earlier(frameTime(track.endInFrames, fps), composition);
    const begin = later(from, start);
    if (compareTime(begin, end) >= 0) return [];
    const offset = addTime(
      frameTime(track.offsetInFrames ?? 0, fps),
      later(subtractTime(from, start), zeroTime),
    );
    return [
      {
        src: track.src,
        delay: toSeconds(subtractTime(begin, from)),
        offset: toSeconds(offset),
        duration: toSeconds(subtractTime(end, begin)),
        gain: track.volume ?? 1,
      },
    ];
  });
};

const centiseconds = (() => {
  const rate = createFrameRate({ numerator: 100, denominator: 1 });
  if (!rate.ok) throw new Error(rate.error.message);
  return rate.value;
})();
const pad = (value: bigint) => value.toString().padStart(2, '0');

/** `mm:ss.cc` of a frame's presentation time, the centiseconds floored. */
export const timecode = (frame: number, fps: FrameRate): string => {
  const total = timeToFrameFloor(frameTime(frame, fps), centiseconds);
  return `${pad(total / 6000n)}:${pad((total / 100n) % 60n)}.${pad(total % 100n)}`;
};

/**
 * At most one `show` is in flight; when it answers, the latest wanted frame follows if it differs.
 * A frame slower than the playback interval is then shown late instead of being superseded forever.
 */
export type Presenter = Readonly<{ inFlight: number | undefined; wanted: number | undefined }>;
export type PresenterStep = Readonly<{ state: Presenter; send?: number }>;
export const idlePresenter: Presenter = { inFlight: undefined, wanted: undefined };

export const wantFrame = (state: Presenter, frame: number): PresenterStep =>
  state.inFlight === undefined
    ? { state: { inFlight: frame, wanted: frame }, send: frame }
    : { state: { ...state, wanted: frame } };

export const frameAnswered = (state: Presenter): PresenterStep =>
  state.wanted === undefined || state.wanted === state.inFlight
    ? { state: { inFlight: undefined, wanted: state.wanted } }
    : { state: { inFlight: state.wanted, wanted: state.wanted }, send: state.wanted };

/**
 * Timeline lanes for half-open `[start, end)` intervals: each takes the first lane whose last
 * interval has ended, in the given order, so intervals that never overlap share a row.
 */
export const packLanes = <T extends Readonly<{ start: number; end: number }>>(
  intervals: readonly T[],
): T[][] => {
  const lanes: T[][] = [];
  for (const interval of intervals) {
    const lane = lanes.find((items) => (items.at(-1)?.end ?? 0) <= interval.start);
    if (lane === undefined) lanes.push([interval]);
    else lane.push(interval);
  }
  return lanes;
};
