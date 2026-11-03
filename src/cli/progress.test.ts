import { describe, expect, it } from 'vitest';

import {
  advanceProgress,
  createProgressReporter,
  formatProgress,
  initialProgress,
  type ProgressState,
  type ProgressStyle,
} from './progress.ts';

/** Feeds `steps` of `(completed, atMs)` through the pure state machine. */
const drive = (
  total: number,
  style: ProgressStyle,
  steps: readonly (readonly [number, number])[],
): { readonly lines: readonly string[]; readonly state: ProgressState } => {
  let state = initialProgress(total, 0);
  const lines: string[] = [];
  for (const [completed, atMs] of steps) {
    const next = advanceProgress(state, completed, atMs, style);
    state = next.state;
    if (next.line !== undefined) lines.push(next.line);
  }
  return { lines, state };
};

describe('initialProgress', () => {
  it('starts with nothing completed and no estimate', () => {
    expect(initialProgress(300, 1_000)).toEqual({
      total: 300,
      completed: 0,
      samples: [],
      lastEmittedAtMs: 1_000,
      lastEmittedCompleted: 0,
    });
  });
});

describe('formatProgress', () => {
  it('reads as a frame count, a percentage and the remaining time', () => {
    expect(formatProgress({ completed: 120, total: 300, etaMs: 12_000 })).toBe(
      'rendering 120/300 frames (40%) ETA 12s',
    );
  });

  it('truncates the percentage so it never claims frames that are not done', () => {
    expect(formatProgress({ completed: 1, total: 3 })).toBe('rendering 1/3 frames (33%)');
  });

  it('omits the estimate until there is one', () => {
    expect(formatProgress({ completed: 0, total: 300 })).toBe('rendering 0/300 frames (0%)');
  });

  it('writes short and long remainders in readable units', () => {
    expect(formatProgress({ completed: 1, total: 2, etaMs: 400 })).toBe(
      'rendering 1/2 frames (50%) ETA <1s',
    );
    expect(formatProgress({ completed: 1, total: 2, etaMs: 80_000 })).toBe(
      'rendering 1/2 frames (50%) ETA 1m20s',
    );
  });

  it('says so when there are no frames to render', () => {
    expect(formatProgress({ completed: 0, total: 0, etaMs: 5_000 })).toBe('rendering 0/0 frames');
  });
});

describe('advanceProgress', () => {
  it('does nothing while the completed count does not change', () => {
    const state = initialProgress(100, 0);
    const next = advanceProgress(state, 0, 5_000, 'tty');
    expect(next.line).toBeUndefined();
    expect(next.state).toBe(state);
  });

  it('never runs backwards when a pool reports out of order', () => {
    const started = advanceProgress(initialProgress(100, 0), 40, 1_000, 'line');
    const back = advanceProgress(started.state, 10, 2_000, 'line');
    expect(back.state.completed).toBe(40);
    expect(back.line).toBeUndefined();
  });

  it('rewrites one line at most every 100 ms on a terminal', () => {
    const { lines } = drive(100, 'tty', [
      [1, 100],
      [2, 150],
      [3, 200],
      [4, 250],
      [5, 300],
    ]);
    expect(lines.map((line) => line.split(' ETA')[0])).toEqual([
      'rendering 1/100 frames (1%)',
      'rendering 3/100 frames (3%)',
      'rendering 5/100 frames (5%)',
    ]);
  });

  it('emits every 10% step to a pipe, however fast the frames arrive', () => {
    const steps = Array.from({ length: 100 }, (_, index) => [index + 1, index] as const);
    const { lines } = drive(100, 'line', steps);
    expect(lines.map((line) => line.split(' ')[1])).toEqual([
      '10/100',
      '20/100',
      '30/100',
      '40/100',
      '50/100',
      '60/100',
      '70/100',
      '80/100',
      '90/100',
      '100/100',
    ]);
  });

  it('thins a 300-frame render to ten lines plus the last frame', () => {
    const steps = Array.from({ length: 300 }, (_, index) => [index + 1, index * 10] as const);
    const { lines } = drive(300, 'line', steps);
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toContain('300/300');
  });

  it('always reports the last frame, whatever the interval', () => {
    const { lines } = drive(5, 'line', [
      [1, 0],
      [4, 10],
      [5, 20],
    ]);
    expect(lines.at(-1)).toBe('rendering 5/5 frames (100%)');
  });

  it('estimates the remainder from the recent rate', () => {
    // 50 frames per second over the sampled window, with 250 of 300 left.
    const { state } = drive(300, 'line', [
      [50, 1_000],
      [100, 2_000],
    ]);
    const next = advanceProgress(state, 150, 3_000, 'line');
    expect(next.line).toBe('rendering 150/300 frames (50%) ETA 3s');
  });

  it('follows the latest rate when the render speeds up, not the run average', () => {
    // Ten seconds for the first 20 frames, then 100 frames per second.
    const { state } = drive(400, 'line', [
      [20, 10_000],
      [40, 20_000],
      [140, 21_000],
    ]);
    // The last two seconds produced 200 frames, and 160 remain.
    expect(advanceProgress(state, 240, 22_000, 'line').line).toContain('ETA 2s');
  });

  it('drops an estimate the recent window cannot produce one from', () => {
    const { state } = drive(100, 'line', [[10, 5_000]]);
    const next = advanceProgress(state, 20, 5_000, 'line');
    // Two steps at the same instant say nothing about the rate.
    expect(next.line).not.toContain('ETA');
  });

  it('does not set the pace from a burst shorter than the rate floor', () => {
    const { state } = drive(300, 'line', [
      [50, 1_000],
      [100, 1_050],
    ]);
    expect(advanceProgress(state, 150, 1_100, 'line').line).not.toContain('ETA');
  });
});

describe('createProgressReporter', () => {
  const collect = (
    options: Parameters<typeof createProgressReporter>[0] & {
      readonly times: readonly number[];
    },
  ): {
    readonly written: string[];
    readonly run: (completed: number) => void;
    finish: () => void;
  } => {
    const written: string[] = [];
    let index = 0;
    const reporter = createProgressReporter({
      ...options,
      clock: { nowMs: () => options.times[index] ?? 0 },
      write: (text) => written.push(text),
    });
    return {
      written,
      run: (completed) => {
        index += 1;
        reporter.update(completed);
      },
      finish: reporter.finish,
    };
  };

  it('overwrites one line on a terminal and ends it before the summary', () => {
    const reporter = collect({ total: 100, level: 'normal', tty: true, times: [0, 500, 1_000] });
    reporter.run(50);
    reporter.run(100);
    reporter.finish();
    expect(reporter.written).toEqual([
      '\rrendering 50/100 frames (50%)',
      '\rrendering 100/100 frames (100%)',
      '\n',
    ]);
  });

  it('writes whole lines to a pipe', () => {
    const reporter = collect({
      total: 100,
      level: 'normal',
      tty: false,
      times: [0, 500, 1_000],
    });
    reporter.run(50);
    reporter.run(100);
    reporter.finish();
    expect(reporter.written).toEqual([
      'rendering 50/100 frames (50%)\n',
      'rendering 100/100 frames (100%)\n',
    ]);
  });

  it('writes nothing under --quiet', () => {
    const reporter = collect({ total: 100, level: 'quiet', tty: true, times: [0, 500] });
    reporter.run(100);
    reporter.finish();
    expect(reporter.written).toEqual([]);
  });

  it('leaves the terminal line alone when it never wrote one', () => {
    const reporter = collect({ total: 0, level: 'normal', tty: true, times: [0] });
    reporter.finish();
    expect(reporter.written).toEqual([]);
  });
});
