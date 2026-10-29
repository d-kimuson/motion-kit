import { beforeEach, expect, it, vi } from 'vitest';

import type * as RendererModule from './renderer.ts';

import { type FrameCaptureResult } from './capture/frame.ts';

const state = vi.hoisted(() => ({ calls: [] as number[][] }));
vi.mock('./renderer.ts', async (importOriginal) => {
  const original = await importOriginal<typeof RendererModule>();
  return {
    ...original,
    createRenderer: () => {
      const calls: number[] = [];
      state.calls.push(calls);
      return Promise.resolve({
        ok: true as const,
        value: {
          descriptor: () => ({
            id: 'x',
            width: 16,
            height: 16,
            fps: { numerator: 30, denominator: 1 },
            durationInFrames: 12,
          }),
          renderFrame: ({ frame }: { frame: number }): Promise<FrameCaptureResult> => {
            calls.push(frame);
            return Promise.resolve({
              ok: true,
              value: {
                frame,
                width: 16,
                height: 16,
                format: 'jpeg',
                image: Buffer.from('x'),
                diagnostics: [],
              },
            });
          },
          dispose: () => Promise.resolve({ ok: true as const, value: undefined }),
        },
      });
    },
  };
});
import { createRendererPool } from './pool.ts';
import { renderVideo } from './render-video.ts';

beforeEach(() => {
  state.calls.length = 0;
});

it('bounds list prefetch to two frames per renderer and drains on early return', async () => {
  const opened = await createRendererPool({ projectRoot: '.', entry: 'entry.ts', concurrency: 3 });
  if (!opened.ok) throw new Error('pool failed');
  const iterator = opened.value
    .renderFrameList({ frames: [0, 1, 2, 3, 4, 5, 6, 7] })
    [Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ ok: true, value: { frame: 0 } });
  expect(state.calls).toEqual([
    [0, 3],
    [1, 4],
    [2, 5],
  ]);
  await iterator.return?.();
  await opened.value.dispose();
});

it('submits single-renderer ranges and frame lists one at a time', async () => {
  const opened = await createRendererPool({ projectRoot: '.', entry: 'entry.ts', concurrency: 1 });
  if (!opened.ok) throw new Error('pool failed');
  for (const [stream, expected] of [
    [opened.value.renderFrames({ from: 1, to: 4 }), [1, 2, 3]],
    [opened.value.renderFrameList({ frames: [4, 2, 8] }), [4, 2, 8]],
  ] as const) {
    state.calls[0]?.splice(0);
    const iterator = stream[Symbol.asyncIterator]();
    for (let index = 0; index < expected.length; index++) {
      expect((await iterator.next()).value).toMatchObject({
        ok: true,
        value: { frame: expected[index] },
      });
      expect(state.calls).toEqual([expected.slice(0, index + 1)]);
    }
    expect((await iterator.next()).done).toBe(true);
  }
  await opened.value.dispose();
});

it('deals reduced-rate source frames across renderers and yields in order', async () => {
  const opened = await createRendererPool({ projectRoot: '.', entry: 'entry.ts', concurrency: 3 });
  if (!opened.ok) throw new Error('pool failed');
  const seen: number[] = [];
  const outcome = await renderVideo({
    composition: opened.value,
    output: '/tmp/unused.mp4',
    fps: { numerator: 15, denominator: 1 },
    encoder: {
      encode: async ({ frames }) => {
        for await (const result of frames) if (result.ok) seen.push(result.value.frame);
        return { ok: false, aborted: true };
      },
    },
  });
  expect(outcome).toEqual({ ok: false, aborted: true });
  expect(seen).toEqual([0, 2, 4, 6, 8, 10]);
  expect(state.calls).toEqual([
    [0, 6],
    [2, 8],
    [4, 10],
  ]);
  await opened.value.dispose();
});
