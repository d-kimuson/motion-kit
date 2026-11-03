import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as rendererModule from './renderer.ts';

import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { createRendererPool } from './pool.ts';
import { createRenderer, type RenderOutcome, type Renderer } from './renderer.ts';

// The pool's own contract check: a resolver that varies between realms must fail at mount, before
// any frame. Stubbing the renderer keeps the case deterministic and free of browsers.
vi.mock('./renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof rendererModule>();
  return { ...actual, createRenderer: vi.fn() };
});

const descriptor = (durationInFrames: number, width = 32): LoadingDescriptor => ({
  id: 'derived',
  width,
  height: 32,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames,
});
const renderer = (resolved: LoadingDescriptor) => {
  const dispose = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
  const value: Renderer = {
    descriptor: () => resolved,
    dispose,
    renderFrame: () => Promise.resolve({ ok: false, aborted: true }),
    renderFrames: async function* () {},
    select: () => Promise.resolve({ ok: false, aborted: true }),
  };
  return { value, dispose };
};
const openWith = (...resolved: readonly LoadingDescriptor[]) => {
  const opened = resolved.map(renderer);
  const mocked = vi.mocked(createRenderer);
  for (const item of opened) mocked.mockResolvedValueOnce({ ok: true, value: item.value });
  return opened;
};
const options = { projectRoot: '/tmp/project', entry: 'entry.ts', concurrency: 2 } as const;

beforeEach(() => {
  vi.mocked(createRenderer).mockReset();
});

describe('renderer pool metadata', () => {
  it('disposes every realm and reports the mismatch when the realms disagree', async () => {
    const opened = openWith(descriptor(4), descriptor(6));
    const result: RenderOutcome<unknown> = await createRendererPool({ ...options });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'render.page-error',
        location: { compositionId: 'derived' },
      },
    });
    if (result.ok || !('error' in result)) throw new Error('a mismatch must fail the pool');
    expect(result.error.message).toContain('different metadata');
    expect(result.error.hint).toContain('deterministic');
    expect(result.error.hint).toContain('resolveMetadata');
    for (const item of opened) expect(item.dispose).toHaveBeenCalledOnce();
  });

  it('reports a different resolution the same way', async () => {
    const opened = openWith(descriptor(4), descriptor(4, 64));
    const result = await createRendererPool({ ...options });
    expect(result).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    for (const item of opened) expect(item.dispose).toHaveBeenCalledOnce();
  });

  it('opens the pool when every realm resolved the same metadata', async () => {
    openWith(descriptor(4), descriptor(4));
    const result = await createRendererPool({ ...options });
    if (!result.ok) throw new Error('aborted' in result ? 'aborted' : result.error.message);
    expect(result.value.concurrency).toBe(2);
    expect(result.value.descriptor()).toEqual(descriptor(4));
    expect(await result.value.dispose()).toEqual({ ok: true, value: undefined });
  });
});
