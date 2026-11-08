import { describe, expect, it } from 'vitest';

import { type FrameSnapshot } from '../core/runtime/composition-runtime.ts';
import { createTimelineTime, toSeconds, type TimelineTime } from '../core/timeline/time.ts';
import { createCanvasSettlement, type CanvasTarget } from './settlement.ts';
import { type TextureUploadFailure } from './texture-upload.ts';

const compositionId = 'settlement-composition';

const timelineTime = (seconds: number): TimelineTime => {
  const value = createTimelineTime(seconds);
  if (!value.ok) throw new Error(value.error.message);
  return value.value;
};

const snapshot = (generation: number, globalFrame = 1): FrameSnapshot => ({
  instance: 'settlement-test',
  revision: 'revision-1',
  source: 'renderer',
  generation,
  globalFrame,
  fps: { numerator: 30, denominator: 1 },
  presentationTime: timelineTime(globalFrame / 30),
  resourceRevision: 0,
});

/** A `CanvasTarget` that records what settlement does to it, in order. */
type FakeTarget = {
  readonly target: CanvasTarget;
  readonly calls: string[];
  readonly advanced: number[];
};

const fakeTarget = (
  options: {
    sized?: boolean;
    contextLost?: boolean;
    textureFailures?: readonly TextureUploadFailure[];
  } = {},
): FakeTarget => {
  const calls: string[] = [];
  const advanced: number[] = [];
  return {
    calls,
    advanced,
    target: {
      sized: () => options.sized ?? true,
      advance: (seconds) => {
        calls.push('advance');
        advanced.push(seconds);
      },
      context: () => ({
        finish: () => {
          calls.push('finish');
        },
        isContextLost: () => {
          calls.push('isContextLost');
          return options.contextLost ?? false;
        },
      }),
      useFrameSubscribers: () => 0,
      textureUploadFailures: () => {
        calls.push('textureUploadFailures');
        return options.textureFailures ?? [];
      },
    },
  };
};

/** Let every wait that could settle without being woken run, before asserting that it did not. */
const settleWindow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('canvas settlement', () => {
  it('fails the frame as render.page-error when the context is lost at settle time', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget({ contextLost: true });
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(4);

    const result = await settlement.settle(snapshot(4), new AbortController().signal);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        location: { compositionId, frame: 1, timeSeconds: 1 / 30 },
      },
    });
    expect(fake.calls).toEqual(['advance', 'finish', 'isContextLost']);
  });

  it('advances once per settle, then fences the GPU, then checks the context', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget();
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(4);
    const { signal } = new AbortController();

    expect(await settlement.settle(snapshot(4), signal)).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual(['advance', 'finish', 'isContextLost', 'textureUploadFailures']);
    expect(fake.advanced).toEqual([toSeconds(snapshot(4).presentationTime)]);

    expect(await settlement.settle(snapshot(4), signal)).toEqual({ ok: true, value: undefined });
    expect(fake.advanced).toHaveLength(2);
    expect(fake.calls).toEqual([
      'advance',
      'finish',
      'isContextLost',
      'textureUploadFailures',
      'advance',
      'finish',
      'isContextLost',
      'textureUploadFailures',
    ]);
  });

  it('settles when the root and the generation arrive while it waits', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget({ sized: false });
    const pending = settlement.settle(snapshot(4), new AbortController().signal);

    await settleWindow();
    expect(fake.calls).toEqual([]);
    settlement.reportTarget({ ...fake.target, sized: () => true });
    await settleWindow();
    expect(fake.calls).toEqual([]);
    settlement.reportGeneration(4);

    expect(await pending).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual(['advance', 'finish', 'isContextLost', 'textureUploadFailures']);
  });

  it('resolves without a Diagnostic when the request aborts while waiting for a size', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget({ sized: false });
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(4);
    const controller = new AbortController();

    const pending = settlement.settle(snapshot(4), controller.signal);
    controller.abort();

    expect(await pending).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual([]);
  });

  it('resolves without a Diagnostic when the request aborts while waiting for the generation', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget();
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(3);
    const controller = new AbortController();

    const pending = settlement.settle(snapshot(4), controller.signal);
    controller.abort();

    expect(await pending).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual([]);
  });

  it('does not settle a stale generation, even when it was reported earlier', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget();
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(4);
    // The root has committed a newer generation since; the request's own generation is superseded.
    settlement.reportGeneration(5);
    const controller = new AbortController();
    let settled = false;
    const pending = settlement.settle(snapshot(4), controller.signal).then((result) => {
      settled = true;
      return result;
    });

    await settleWindow();
    expect(settled).toBe(false);
    expect(fake.calls).toEqual([]);

    // Only the abort ends the wait: the stale generation never satisfies it.
    controller.abort();
    expect(await pending).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual([]);
  });

  it('fails every frame after a shader program failed, because three checks it only once', async () => {
    const settlement = createCanvasSettlement(compositionId);
    const fake = fakeTarget();
    settlement.reportTarget(fake.target);
    settlement.reportGeneration(4);
    settlement.reportShaderError();
    const { signal } = new AbortController();

    const first = await settlement.settle(snapshot(4, 3), signal);
    settlement.reportGeneration(5);
    const second = await settlement.settle(snapshot(5, 6), signal);

    // Each failure names the frame it fails, not the frame whose render first hit the program.
    for (const [outcome, frame] of [
      [first, 3],
      [second, 6],
    ] as const) {
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: 'render.page-error',
          severity: 'error',
          location: { compositionId, frame, timeSeconds: frame / 30 },
        },
      });
      if (outcome.ok) return;
      expect(outcome.error.message).toContain('shader');
    }
    // The advance still runs: it is what reaches the program's first use.
    expect(fake.advanced).toHaveLength(2);
  });

  describe('texture uploads', () => {
    const failure: TextureUploadFailure = {
      slot: 'map',
      texture: 'logo',
      object: 'sign',
      material: 'MeshBasicMaterial',
      reason: 'no-image',
    };

    it('fails the frame after the render, naming the texture and the frame', async () => {
      const settlement = createCanvasSettlement(compositionId);
      const fake = fakeTarget({ textureFailures: [failure] });
      settlement.reportTarget(fake.target);
      settlement.reportGeneration(4);

      const result = await settlement.settle(snapshot(4, 2), new AbortController().signal);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'render.page-error',
          severity: 'error',
          location: { compositionId, frame: 2, timeSeconds: 2 / 30 },
          details: { textures: [{ texture: 'logo', slot: 'map', reason: 'no-image' }] },
        },
      });
      if (result.ok) return;
      expect(result.error.message).toContain('texture "logo" in map of "sign"');
      // The textures are read after the render: before it nothing has been uploaded.
      expect(fake.calls).toEqual(['advance', 'finish', 'isContextLost', 'textureUploadFailures']);
    });

    it('counts the failed textures when several failed, and names an unnamed texture', async () => {
      const settlement = createCanvasSettlement(compositionId);
      const fake = fakeTarget({
        textureFailures: [{ ...failure, texture: '', object: '' }, failure],
      });
      settlement.reportTarget(fake.target);
      settlement.reportGeneration(4);

      const result = await settlement.settle(snapshot(4), new AbortController().signal);

      if (result.ok) throw new Error('expected a failure');
      expect(result.error.message).toBe(
        '2 textures were not uploaded while settling the frame, the first being unnamed texture in map of MeshBasicMaterial.',
      );
      expect(result.error.details).toMatchObject({
        textures: [{ texture: '' }, { texture: 'logo' }],
      });
    });

    it('settles when every texture was uploaded', async () => {
      const settlement = createCanvasSettlement(compositionId);
      const fake = fakeTarget({ textureFailures: [] });
      settlement.reportTarget(fake.target);
      settlement.reportGeneration(4);

      expect(await settlement.settle(snapshot(4), new AbortController().signal)).toEqual({
        ok: true,
        value: undefined,
      });
    });

    it('reports a lost context and a shader failure before a texture', async () => {
      const lost = createCanvasSettlement(compositionId);
      lost.reportTarget(fakeTarget({ contextLost: true, textureFailures: [failure] }).target);
      lost.reportGeneration(4);
      const shader = createCanvasSettlement(compositionId);
      shader.reportTarget(fakeTarget({ textureFailures: [failure] }).target);
      shader.reportGeneration(4);
      shader.reportShaderError();
      const { signal } = new AbortController();

      const lostResult = await lost.settle(snapshot(4), signal);
      const shaderResult = await shader.settle(snapshot(4), signal);

      if (lostResult.ok || shaderResult.ok) throw new Error('expected failures');
      expect(lostResult.error.message).toContain('context was lost');
      expect(shaderResult.error.message).toContain('shader');
    });
  });
});
