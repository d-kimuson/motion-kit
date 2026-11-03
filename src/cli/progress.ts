import { type LogLevel } from '../lib/log.ts';

// A long render has no other sign of life: the artifact appears only at the end. `render` therefore
// reports completed frames out of the artifact's total, with an estimate of the remainder, on
// stderr (stdout is the envelope when `--json`). The formatting, the thinning and the estimate are
// pure functions of a state and an injected monotonic clock, so the only impure part is the write.

export type ProgressClock = { readonly nowMs: () => number };

/** A terminal gets one rewritten line; a pipe gets whole lines, thinned by the percentage. */
export type ProgressStyle = 'tty' | 'line';

/** One reading of the completed count, kept to estimate the rate from. */
export type ProgressSample = { readonly atMs: number; readonly completed: number };

export type ProgressState = {
  readonly total: number;
  /** The highest completed count reported so far; a pool may report out of order. */
  readonly completed: number;
  readonly samples: readonly ProgressSample[];
  readonly lastEmittedAtMs: number;
  readonly lastEmittedCompleted: number;
};

export type ProgressStep = {
  readonly state: ProgressState;
  readonly line: string | undefined;
};

/** A ceiling on the samples kept, so a render faster than the window cannot grow the state. */
const sampleLimit = 64;

/** The window the rate is averaged over; a burst of pool completions must not set the pace. */
const rateWindowMs = 3_000;

/** A span shorter than this is a burst, not a rate. */
const rateFloorMs = 250;

/** How often a terminal line is rewritten; a faster render would only flicker. */
const ttyIntervalMs = 100;

/** The percentage steps a piped stream is thinned to, one part in ten. */
const lineStep = 10;

/** Whole milliseconds from a monotonic clock: no wall clock, no time zone, no leap second. */
export const monotonicClock: ProgressClock = {
  nowMs: () => Number(process.hrtime.bigint() / 1_000_000n),
};

export const initialProgress = (total: number, startedAtMs: number): ProgressState => ({
  total,
  completed: 0,
  samples: [],
  lastEmittedAtMs: startedAtMs,
  lastEmittedCompleted: 0,
});

/** A duration as a progress line writes it: whole seconds, or minutes and seconds. */
const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1_000) return '<1s';
  const seconds = Math.ceil(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};

export type ProgressReading = {
  readonly completed: number;
  readonly total: number;
  /** Milliseconds left by the recent rate; omitted when the samples cannot say. */
  readonly etaMs?: number;
};

/** The one progress line's text; `total` zero is a legal, empty render. */
export const formatProgress = ({ completed, total, etaMs }: ProgressReading): string => {
  const counted = `rendering ${completed}/${total} frames`;
  if (total === 0) return counted;
  const percent = Math.floor((completed * 100) / total);
  const estimate = etaMs === undefined ? '' : ` ETA ${formatDuration(etaMs)}`;
  return `${counted} (${percent}%)${estimate}`;
};

/**
 * The completion rate over the last `rateWindowMs`, in frames per millisecond, from that window's
 * last and first sample. A pool completes frames in bursts, so an interval-by-interval average
 * swings with the burst; a window that spans a few bursts does not. With no span yet, or a span
 * too short to mean anything, there is no rate.
 */
const recentRate = (samples: readonly ProgressSample[]): number | undefined => {
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const elapsed = last.atMs - first.atMs;
  if (elapsed < rateFloorMs) return undefined;
  const rate = (last.completed - first.completed) / elapsed;
  return rate > 0 ? rate : undefined;
};

/**
 * Keeps the samples inside the rate window; when the updates are sparse enough that the window
 * holds fewer than two, the last two samples are the most recent rate there is.
 */
const windowed = (samples: readonly ProgressSample[], nowMs: number): readonly ProgressSample[] => {
  const cutoff = nowMs - rateWindowMs;
  const inside = samples.filter((sample) => sample.atMs >= cutoff);
  return inside.length >= 2 ? inside : samples.slice(-2);
};

/** Milliseconds the render still needs at `rate`; omitted when it has nothing left to do. */
const estimateRemainingMs = (state: ProgressState): number | undefined => {
  const rate = recentRate(state.samples);
  if (rate === undefined) return undefined;
  const remaining = state.total - state.completed;
  return remaining <= 0 ? undefined : remaining / rate;
};

/**
 * Whether this update gets a line. A terminal is thinned by time; a pipe is thinned by progress, so
 * a captured log has one line per tenth instead of one per frame. The last frame always reports, so
 * a reader that saw a line knows the render reached its end.
 */
const shouldEmit = (
  state: ProgressState,
  next: number,
  nowMs: number,
  style: ProgressStyle,
): boolean => {
  if (next >= state.total) return true;
  if (style === 'tty') return nowMs - state.lastEmittedAtMs >= ttyIntervalMs;
  return (
    Math.floor((next * lineStep) / state.total) >
    Math.floor((state.lastEmittedCompleted * lineStep) / state.total)
  );
};

/**
 * Folds one completed count into the state and decides whether it is worth a line. It is pure:
 * `nowMs` comes from the caller's clock, so the thinning and the estimate are testable without one.
 */
export const advanceProgress = (
  state: ProgressState,
  completed: number,
  nowMs: number,
  style: ProgressStyle,
): ProgressStep => {
  // A pool reports the frames its renderers finish, in whatever order they finish; the count only
  // ever grows, and never past the total.
  const next = Math.min(Math.max(completed, state.completed), state.total);
  if (next === state.completed) return { state, line: undefined };
  const samples = windowed(
    [...state.samples, { atMs: nowMs, completed: next }].slice(-sampleLimit),
    nowMs,
  );
  const counted: ProgressState = { ...state, completed: next, samples };
  if (!shouldEmit(state, next, nowMs, style)) return { state: counted, line: undefined };
  const emitted: ProgressState = {
    ...counted,
    lastEmittedAtMs: nowMs,
    lastEmittedCompleted: next,
  };
  const etaMs = estimateRemainingMs(emitted);
  const reading: ProgressReading = { completed: next, total: emitted.total };
  return {
    state: emitted,
    line: formatProgress(etaMs === undefined ? reading : { ...reading, etaMs }),
  };
};

export type ProgressReporter = {
  readonly update: (completed: number) => void;
  /** Ends a rewritten terminal line, so the summary that follows starts on its own row. */
  readonly finish: () => void;
};

export type ProgressReporterOptions = {
  /** The artifact's frame count, as the envelope reports it. */
  readonly total: number;
  readonly level: LogLevel;
  readonly tty: boolean;
  readonly clock?: ProgressClock;
  readonly write?: (text: string) => void;
};

/**
 * The impure shell around `advanceProgress`: it owns the clock, the terminal and the state, and
 * writes to stderr. `--quiet` returns a reporter that does nothing at all.
 */
export const createProgressReporter = (options: ProgressReporterOptions): ProgressReporter => {
  const { total, level, tty } = options;
  const clock = options.clock ?? monotonicClock;
  const write = options.write ?? ((text: string) => void process.stderr.write(text));
  let state = initialProgress(total, clock.nowMs());
  let wrote = false;
  if (level === 'quiet')
    return {
      update: () => {},
      finish: () => {},
    };
  return {
    update: (completed) => {
      const step = advanceProgress(state, completed, clock.nowMs(), tty ? 'tty' : 'line');
      state = step.state;
      if (step.line === undefined) return;
      wrote = true;
      write(tty ? `\r${step.line}` : `${step.line}\n`);
    },
    finish: () => {
      if (!tty || !wrote) return;
      wrote = false;
      write('\n');
    },
  };
};
