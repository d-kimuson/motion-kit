// Where a line the renderer's own processes emit goes.
//
// A Composition runs in Chromium and its page console, together with the loading service's child
// process, is a channel of its own: a successful render would otherwise print Vite's handshake, a
// dependency's deprecation warning and Chromium's software-WebGL fallback warning next to the
// Diagnostics the CLI owes its caller (agent ADR: CLI stderr). The producer (`src/render`) tags a
// line and the policy owner (the CLI) picks the level, so the channel lives beside `Result` and
// `Diagnostic`, where both contexts may import it.

/** How much of the renderer's own output reaches stderr while a command runs. */
export type LogLevel = 'quiet' | 'normal' | 'verbose';

/** The processes a record comes from: the Composition's page, or the loading service's child. */
export type LogSource = 'browser' | 'service';

/** One line the renderer emitted, in the words the page or the service wrote it. */
export type LogRecord = {
  readonly source: LogSource;
  readonly text: string;
  /** Known environmental noise (a Chromium or development-server notice). It is the first thing a
   * failure report drops, because it says nothing about the Composition that failed.
   */
  readonly noise: boolean;
};

/** What one record does at one level: reach stderr now, and stay for a failure report. */
export type LogDecision = { readonly stream: boolean; readonly keep: boolean };

/**
 * The whole level policy, as a pure function. The default level streams nothing — a run's stderr
 * carries the Diagnostics and the progress, not the renderer's chatter — but it keeps the recent
 * lines so a failure can show them. `--verbose` streams everything as it arrives; `--quiet` keeps
 * nothing.
 */
export const logDecision = (level: LogLevel, record: LogRecord): LogDecision => {
  if (level === 'verbose') return { stream: true, keep: true };
  if (level === 'quiet') return { stream: false, keep: false };
  return { stream: false, keep: !record.noise };
};

/** A record longer than this is cut, so one runaway line cannot fill a failure report. */
const recordLimit = 500;

/** How many recent records a failure report can show. */
const defaultCapacity = 20;

export type LogChannel = {
  readonly level: () => LogLevel;
  readonly setLevel: (level: LogLevel) => void;
  /** Records one line; the live write happens only when the level allows it. */
  readonly write: (record: LogRecord) => void;
  /** The kept records, oldest first, bounded by the channel's capacity. */
  readonly recent: () => readonly LogRecord[];
};

export type LogChannelOptions = {
  /** The level this channel starts at; `verbose` when omitted, so a library consumer's output
   * keeps flowing exactly as it did before the CLI owned a level.
   */
  readonly level?: LogLevel;
  /** How many records to keep for a failure report. */
  readonly capacity?: number;
  /** Writes one line to its destination; stderr by default. */
  readonly write?: (text: string) => void;
};

const bounded = (text: string): LogRecord['text'] =>
  text.length <= recordLimit ? text : `${text.slice(0, recordLimit - 1)}…`;

const stderr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const createLogChannel = (options: LogChannelOptions = {}): LogChannel => {
  let level: LogLevel = options.level ?? 'verbose';
  const capacity = options.capacity ?? defaultCapacity;
  const sink = options.write ?? stderr;
  const kept: LogRecord[] = [];
  return {
    level: () => level,
    setLevel: (next) => {
      level = next;
    },
    write: (record) => {
      if (record.text.trim() === '') return;
      const decision = logDecision(level, record);
      if (decision.stream) sink(record.text);
      if (!decision.keep) return;
      kept.push({ ...record, text: bounded(record.text) });
      while (kept.length > capacity) kept.shift();
    },
    recent: () => [...kept],
  };
};

let active = createLogChannel();

/** The channel the renderer's processes write to, whichever command is running. */
export const logChannel = (): LogChannel => active;

/** Makes `channel` the process-wide one and returns the restore for it. */
export const setLogChannel = (channel: LogChannel): (() => void) => {
  const previous = active;
  active = channel;
  return () => {
    active = previous;
  };
};
