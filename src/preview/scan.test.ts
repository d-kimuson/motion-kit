import { expect, it } from 'vitest';

import { type ShowOutcome } from '../lib/preview-protocol.ts';
import { scanFrames, type ScanProgress, type ScanStep } from './scan.ts';

const shown = (frame: number): ShowOutcome => ({
  status: 'shown',
  frame,
  sequences: [],
  assets: [],
});

const run = (
  total: number,
  options: {
    batch?: number;
    idle?: () => boolean;
    wake?: () => Promise<void>;
    show?: (frame: number) => Promise<ShowOutcome>;
    signal?: AbortSignal;
  } = {},
) => {
  const shows: number[] = [];
  const reports: { frames: number[]; progress: ScanProgress }[] = [];
  const done = scanFrames({
    show:
      options.show ??
      ((frame) => {
        shows.push(frame);
        return Promise.resolve(shown(frame));
      }),
    total,
    idle: options.idle ?? (() => true),
    wake: options.wake ?? (() => Promise.resolve()),
    report: (steps: readonly ScanStep[], progress) =>
      void reports.push({ frames: steps.map((step) => step.frame), progress }),
    batch: options.batch ?? 2,
    signal: options.signal ?? new AbortController().signal,
  });
  return { done, shows, reports };
};

it('shows every frame in order and reports them a batch at a time, the rest at the end', async () => {
  const { done, shows, reports } = run(5);
  await done;
  expect(shows).toEqual([0, 1, 2, 3, 4]);
  expect(reports).toEqual([
    { frames: [0, 1], progress: { scanned: 2, total: 5 } },
    { frames: [2, 3], progress: { scanned: 4, total: 5 } },
    { frames: [4], progress: { scanned: 5, total: 5 } },
  ]);
});

it('reports an empty Composition as read', async () => {
  const { done, reports } = run(0);
  await done;
  expect(reports).toEqual([{ frames: [], progress: { scanned: 0, total: 0 } }]);
});

it('reports the frames read so far and waits while it may not go on', async () => {
  let idle = true;
  let wake: (() => void) | undefined;
  const shows: number[] = [];
  const { done, reports } = run(4, {
    batch: 10,
    idle: () => idle,
    wake: () =>
      new Promise((resolve) => {
        wake = resolve;
      }),
    show: (frame) => {
      shows.push(frame);
      if (frame === 0) idle = false;
      return Promise.resolve(shown(frame));
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(shows).toEqual([0]);
  expect(reports).toEqual([{ frames: [0], progress: { scanned: 1, total: 4 } }]);
  // A wake that finds it still busy waits again.
  wake?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(shows).toEqual([0]);
  idle = true;
  wake?.();
  await done;
  expect(shows).toEqual([0, 1, 2, 3]);
  expect(reports.at(-1)).toEqual({ frames: [1, 2, 3], progress: { scanned: 4, total: 4 } });
});

it('stops without a report once aborted, or when the realm closed', async () => {
  const controller = new AbortController();
  const aborted = run(4, {
    show: (frame) => {
      if (frame === 1) controller.abort();
      return Promise.resolve(shown(frame));
    },
    signal: controller.signal,
  });
  await aborted.done;
  expect(aborted.reports).toEqual([]);
  const closed = run(4, {
    show: (frame) =>
      frame === 1
        ? Promise.reject(new Error('Preview realm closed'))
        : Promise.resolve(shown(frame)),
  });
  await closed.done;
  expect(closed.reports).toEqual([]);
});
