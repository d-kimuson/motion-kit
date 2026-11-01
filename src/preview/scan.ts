import { type ShowOutcome } from '../lib/preview-protocol.ts';

/** What showing one frame of the scan told. */
export type ScanStep = Readonly<{ frame: number; outcome: ShowOutcome }>;

/** How far a scan read the Composition: frames `[0, scanned)` of `total`. */
export type ScanProgress = Readonly<{ scanned: number; total: number }>;

/**
 * Show every frame of a mounted Composition in order, one at a time, and report what they told
 * `batch` frames at a time, so the host learns the named Sequences and the assets of frames
 * nobody played. Before each frame it waits, by `wake`, while `idle` does not hold, since
 * playback shares the machine with it; the frames read so far are reported before the wait.
 * Stops when `signal` aborts or a `show` rejects (the realm closed); the last report has
 * `scanned === total`.
 */
export const scanFrames = async ({
  show,
  total,
  idle,
  wake,
  report,
  batch,
  signal,
}: Readonly<{
  show: (frame: number) => Promise<ShowOutcome>;
  total: number;
  /** Whether the scan may go on now. */
  idle: () => boolean;
  /** Resolves once `idle` holds again. */
  wake: () => Promise<void>;
  report: (steps: readonly ScanStep[], progress: ScanProgress) => void;
  batch: number;
  signal: AbortSignal;
}>): Promise<void> => {
  let steps: ScanStep[] = [];
  const flush = (scanned: number) => {
    report(steps, { scanned, total });
    steps = [];
  };
  for (let frame = 0; frame < total; frame += 1) {
    if (signal.aborted) return;
    if (!idle() && steps.length > 0) flush(frame);
    while (!idle()) {
      await wake();
      if (signal.aborted) return;
    }
    let outcome: ShowOutcome;
    try {
      outcome = await show(frame);
    } catch {
      return;
    }
    if (signal.aborted) return;
    steps.push({ frame, outcome });
    if (steps.length >= batch) flush(frame + 1);
  }
  if (steps.length > 0 || total === 0) flush(total);
};
