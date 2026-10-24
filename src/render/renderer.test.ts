import { createRenderer, type Renderer, type RenderedFrame } from '@kimuson/motion-kit/render';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requiredDeterminismModes } from './determinism/compare.ts';
import { defineDeterminismSuite, runDeterminismSuite } from './determinism/suite.ts';
import * as loading from './loading/session.ts';

const require = createRequire(import.meta.url);
const sessions: loading.LoadingSession[] = [];
const renderers: Renderer[] = [];
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-capture-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(new URL('../core/runtime/fixtures/capture.tsx', import.meta.url).pathname)};`,
  );
  const original = loading.openLoadingSession;
  vi.spyOn(loading, 'openLoadingSession').mockImplementation(async (options) => {
    const result = await original(options);
    if (result.ok) sessions.push(result.value);
    return result;
  });
});
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await renderer.dispose();
  for (const session of sessions.splice(0)) await session.dispose();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
const open = async (mode = 'normal', frameTimeoutMs = 5000) => {
  const result = await createRenderer({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: 'one',
    props: { mode },
    frameTimeoutMs,
  });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error('Renderer creation failed');
  renderers.push(result.value);
  return result.value;
};
const frame = async (renderer: Renderer, number: number): Promise<RenderedFrame> => {
  const result = await renderer.renderFrame({ frame: number });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error('Capture failed');
  return result.value;
};
const session = () => {
  const value = sessions.at(-1);
  if (value === undefined) throw new Error('Session missing');
  return value;
};
const assertGone = async (owned: loading.LoadingSession) => {
  expect(() => process.kill(owned.servicePid, 0)).toThrow(/ESRCH/);
  expect(() => process.kill(owned.browserPid, 0)).toThrow(/ESRCH/);
  expect(existsSync(owned.workspace)).toBe(false);
  await expect(fetch(owned.url)).rejects.toThrow(/fetch failed/);
};
describe('qualified Chromium PNG transport', () => {
  it('captures exact DOM CSS SVG Canvas pixels at the composition crop', async () => {
    const started = process.hrtime.bigint();
    const renderer = await open();
    console.info(
      `Capture fixture: Chromium ${session().page().context().browser()?.version()}, DPR 1, 64x64; loading + selection ${Number(process.hrtime.bigint() - started) / 1e6} ms`,
    );
    const output = await frame(renderer, 2);
    const pixels = await session()
      .page()
      .evaluate(
        async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          );
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('Canvas unavailable');
          context.drawImage(bitmap, 0, 0);
          const samples = [
            [8, 8],
            [40, 8],
            [8, 40],
            [40, 40],
          ].map(([x, y]) => [...context.getImageData(x ?? 0, y ?? 0, 1, 1).data]);
          return { width: bitmap.width, height: bitmap.height, samples };
        },
        [...output.png],
      );
    expect(pixels).toEqual({
      width: 64,
      height: 64,
      samples: [
        [80, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 80, 0, 255],
        [0, 0, 80, 255],
      ],
    });
    expect(await renderer.dispose()).toEqual({ ok: true, value: undefined });
    await assertGone(session());
  }, 60_000);

  it('matches sequential single random reverse repeated fresh-realm and held-session bytes with nonconstant frames', async () => {
    const report = await runDeterminismSuite(
      defineDeterminismSuite({
        composition: {
          name: 'capture-fixture',
          modulePath: new URL('../core/runtime/fixtures/capture.tsx', import.meta.url).pathname,
          compositionId: 'one',
          props: { mode: 'normal' },
        },
        frames: [0, 1, 2, 3, 4, 5],
      }),
      { servicePid: () => session().servicePid },
    );
    for (const mode of report.compositions.flatMap((item) => item.modes))
      console.info(mode.message);
    expect(report.passed).toBe(true);
    expect(report.compositions[0]?.framesDiffer).toBe(true);
    expect(report.compositions[0]?.modes.map((mode) => mode.mode)).toEqual([
      ...requiredDeterminismModes,
    ]);
  }, 60_000);

  it.each([
    ['asset', 'asset.not-ready'],
    ['pending', 'render.frame-timeout'],
    ['failed', 'asset.load-failed'],
  ])(
    'maps %s failure and removes OS resources',
    async (mode, code) => {
      const renderer = await open(mode, 500);
      const owned = session();
      const result = await renderer.renderFrame({ frame: 2 });
      expect(result).toMatchObject({ ok: false, error: [{ code }] });
      expect(JSON.stringify(result)).not.toContain('secret');
      await assertGone(owned);
    },
    60_000,
  );

  it('terminates a blocked page RPC at the host deadline with no leaked process', async () => {
    const renderer = await open('normal', 500);
    const owned = session();
    await owned.page().evaluate(() => {
      const api = window.__motionKit;
      if (api === undefined) throw new Error('Missing page');
      const settle = api.settleFrame;
      api.settleFrame = async (number, request) => {
        await settle(number, request);
        for (;;) {
          /* Deliberate main-thread stall; only host termination can stop it. */
        }
      };
    });
    expect(await renderer.renderFrame({ frame: 2 })).toMatchObject({
      ok: false,
      error: [{ code: 'render.frame-timeout' }],
    });
    await assertGone(owned);
  }, 60_000);

  it('cancels active work without a fabricated diagnostic or frame and cleans OS resources', async () => {
    const renderer = await open('pending');
    const owned = session();
    const controller = new AbortController();
    const result = renderer.renderFrame({ frame: 2, signal: controller.signal });
    // Wait for the actual ownership event, not a sleep standing in for readiness.
    await owned.page().waitForFunction(() => document.querySelector('canvas') !== null);
    controller.abort();
    expect(await result).toEqual({ ok: false, aborted: true });
    await assertGone(owned);
  }, 60_000);

  it('suppresses a stale-generation RPC lease and cleans OS resources', async () => {
    const renderer = await open();
    const owned = session();
    await owned.page().evaluate(() => {
      const api = window.__motionKit;
      if (api === undefined) throw new Error('Missing page');
      const settle = api.settleFrame;
      api.settleFrame = async (number, request) => {
        const result = await settle(number, request);
        return result.status === 'ready'
          ? { ...result, lease: { ...result.lease, generation: result.lease.generation + 1 } }
          : result;
      };
    });
    expect(await renderer.renderFrame({ frame: 2 })).toEqual({ ok: false, aborted: true });
    await assertGone(owned);
  }, 60_000);

  it('re-settles a changed source after capture under the same generation', async () => {
    const renderer = await open();
    const page = session().page();
    const screenshot = page.screenshot.bind(page);
    await frame(renderer, 1);
    await page.evaluate(() => {
      const runtime = window.__captureFixture;
      if (runtime === undefined) throw new Error('Missing runtime');
      const remove = runtime.registerIntegration({
        id: 'changed-source',
        version: '1',
        seekability: 'B',
        settle: () => Promise.resolve({ ok: true, value: undefined }),
      });
      window.__captureFixtureChangeSource = () => {
        remove();
        runtime.registerIntegration({
          id: 'changed-source',
          version: '2',
          seekability: 'B',
          settle: () => {
            const context = document.querySelector('canvas')?.getContext('2d');
            if (context === undefined || context === null) throw new Error('Missing canvas');
            context.fillStyle = '#ff00ff';
            context.fillRect(0, 0, 32, 32);
            return Promise.resolve({ ok: true, value: undefined });
          },
        });
      };
    });
    let discarded: Buffer | undefined;
    const generations: number[] = [];
    const capture = vi.spyOn(page, 'screenshot').mockImplementation(async (options) => {
      const bytes = await screenshot(options);
      generations.push(
        await page.evaluate(() => window.__captureFixture?.getSnapshot()?.generation ?? -1),
      );
      if (discarded === undefined) {
        discarded = bytes;
        await page.evaluate(() => window.__captureFixtureChangeSource?.());
      }
      return bytes;
    });
    const output = await frame(renderer, 2);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(generations).toEqual([2, 2]);
    expect(output.png.equals(discarded ?? Buffer.alloc(0))).toBe(false);
  }, 60_000);

  it('queues renderer frames through screenshot completion and removes a canceled queued request', async () => {
    const renderer = await open();
    const page = session().page();
    const screenshot = page.screenshot.bind(page);
    const capturing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(page, 'screenshot').mockImplementationOnce(async (options) => {
      capturing.resolve();
      await release.promise;
      return screenshot(options);
    });
    const first = renderer.renderFrame({ frame: 2 });
    await capturing.promise;
    const controller = new AbortController();
    const canceled = renderer.renderFrame({ frame: 3, signal: controller.signal });
    const next = renderer.renderFrame({ frame: 4 });
    controller.abort();
    expect(await canceled).toEqual({ ok: false, aborted: true });
    expect(await page.evaluate(() => window.__captureFixture?.getSnapshot()?.globalFrame)).toBe(2);
    release.resolve();
    expect(await first).toMatchObject({ ok: true, value: { frame: 2 } });
    expect(await next).toMatchObject({ ok: true, value: { frame: 4 } });
    expect(await page.evaluate(() => window.__captureFixture?.getSnapshot()?.generation)).toBe(2);
  }, 60_000);

  it('warns for a detected Tier C integration without certifying determinism', async () => {
    const renderer = await open('uncontrolled');
    expect((await frame(renderer, 2)).diagnostics).toMatchObject([
      { code: 'seek.uncontrolled', severity: 'warning', location: { frame: 2 } },
    ]);
  }, 60_000);

  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, -1, 6])(
    'validates output frame %s without invalid diagnostic locations',
    async (number) => {
      const renderer = await open();
      const owned = session();
      const result = await renderer.renderFrame({ frame: number });
      expect(result).toMatchObject({
        ok: false,
        error: [{ code: 'composition.props-invalid' }],
      });
      if (result.ok || !('error' in result)) throw new Error('Expected invalid frame diagnostic');
      expect(result.error[0]?.location?.frame).toBe(
        Number.isSafeInteger(number) ? number : undefined,
      );
      await assertGone(owned);
    },
    60_000,
  );
});
