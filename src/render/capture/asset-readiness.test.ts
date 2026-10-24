import { createRenderer, type Renderer, type RenderedFrame } from 'motion-kit/render';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as loading from '../loading/session.ts';

const require = createRequire(import.meta.url);
const fontBytes = readFileSync(
  new URL('../../../spikes/d-assets/assets/Abel-Regular.ttf', import.meta.url),
);
const imageBytes = readFileSync(
  new URL('../../../spikes/d-assets/assets/checker.svg', import.meta.url),
);
const sessions: loading.LoadingSession[] = [];
const renderers: Renderer[] = [];
let directory: string;

afterEach(async () => {
  for (const renderer of renderers.splice(0)) await renderer.dispose();
  for (const session of sessions.splice(0)) await session.dispose();
  vi.restoreAllMocks();
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
});

const open = async (compositionId = 'assets') => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-assets-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(new URL('../../core/runtime/fixtures/assets.tsx', import.meta.url).pathname)};`,
  );
  const original = loading.openLoadingSession;
  vi.spyOn(loading, 'openLoadingSession').mockImplementation(async (options) => {
    const result = await original(options);
    if (result.ok) sessions.push(result.value);
    return result;
  });
  const result = await createRenderer({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId,
    frameTimeoutMs: 15_000,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Renderer creation failed');
  renderers.push(result.value);
  return result.value;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readSource = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('source' in value)) return undefined;
  const source = value['source'];
  return typeof source === 'string' ? source : undefined;
};

const failedSources = (result: {
  ok: boolean;
  error?: readonly { details?: Readonly<Record<string, unknown>> }[];
}): string[] => {
  if (result.ok || result.error === undefined) return [];
  const sources: string[] = [];
  for (const diagnostic of result.error) {
    const assets = diagnostic.details?.['assets'];
    if (!Array.isArray(assets)) continue;
    for (const asset of assets) {
      const source = readSource(asset);
      if (source !== undefined) sources.push(source);
    }
  }
  return sources;
};

const routeMissing = async (page: ReturnType<loading.LoadingSession['page']>) => {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.includes('fail-a.png') ||
      url.includes('fail-b.png') ||
      url.includes('loader-rejected.png') ||
      url.includes('boundary.png')
    ) {
      await route.fulfill({ status: 404, body: 'missing' });
      return;
    }
    await route.continue();
  });
};

describe('asset readiness barrier', () => {
  it('captures only after the delayed font and image load', async () => {
    const renderer = await open();
    const owned = sessions.at(-1);
    if (owned === undefined) throw new Error('Session missing');
    const page = owned.page();
    const release = Promise.withResolvers<void>();
    let fontFulfilled: bigint | undefined;
    let imageFulfilled: bigint | undefined;
    let capturedAt: bigint | undefined;
    let capturedWhilePending = false;
    await page.route('**/gated-font.ttf*', async (route) => {
      await release.promise;
      fontFulfilled = process.hrtime.bigint();
      await route.fulfill({
        status: 200,
        contentType: 'font/ttf',
        headers: { 'cache-control': 'no-store' },
        body: fontBytes,
      });
    });
    await page.route('**/gated-image.svg*', async (route) => {
      await release.promise;
      imageFulfilled = process.hrtime.bigint();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'cache-control': 'no-store' },
        body: imageBytes,
      });
    });
    const screenshot = page.screenshot.bind(page);
    vi.spyOn(page, 'screenshot').mockImplementation(async (options) => {
      const state = await page.evaluate(() => ({
        pending: window.__motionKit?.assetReadiness().pending.length ?? -1,
        ready: document.documentElement.dataset['assetsReady'] === 'true',
        font: document.fonts.check('normal 400 28px GatedAbel', 'Ag'),
      }));
      capturedAt = process.hrtime.bigint();
      if (state.pending > 0 || !state.ready || !state.font) capturedWhilePending = true;
      return screenshot(options);
    });
    const started = process.hrtime.bigint();
    const rendering = renderer.renderFrame({ frame: 0 });
    await page.waitForFunction(
      () => (window.__motionKit?.assetReadiness().pending.length ?? 0) >= 2,
      undefined,
      { timeout: 10_000 },
    );
    const observed = process.hrtime.bigint();
    await page.evaluate(() => {
      const probe = window as Window & {
        __whenReadySettled?: boolean;
        __whenReadyResult?: unknown;
      };
      probe.__whenReadySettled = false;
      void window.__motionKit?.whenReady(8_000).then((result) => {
        probe.__whenReadyResult = result;
        probe.__whenReadySettled = true;
      });
    });
    await delay(200);
    expect(capturedAt).toBeUndefined();
    expect(
      await page.evaluate(
        () => (window as Window & { __whenReadySettled?: boolean }).__whenReadySettled,
      ),
    ).toBe(false);
    let resolved = false;
    void rendering.then(() => {
      resolved = true;
    });
    await delay(30);
    expect(resolved).toBe(false);
    const releasedAt = process.hrtime.bigint();
    release.resolve();
    const result = await rendering;
    const finishedAt = process.hrtime.bigint();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Capture failed');
    const output: RenderedFrame = result.value;
    expect(capturedWhilePending).toBe(false);
    expect(fontFulfilled).toBeDefined();
    expect(imageFulfilled).toBeDefined();
    expect(capturedAt).toBeDefined();
    if (fontFulfilled === undefined || imageFulfilled === undefined || capturedAt === undefined)
      throw new Error('missing timing');
    expect(observed > started).toBe(true);
    expect(releasedAt > observed).toBe(true);
    expect(fontFulfilled > releasedAt).toBe(true);
    expect(imageFulfilled > releasedAt).toBe(true);
    expect(capturedAt > fontFulfilled).toBe(true);
    expect(capturedAt > imageFulfilled).toBe(true);
    expect(finishedAt > capturedAt).toBe(true);
    expect(
      await page.evaluate(
        () => (window as Window & { __whenReadySettled?: boolean }).__whenReadySettled,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as Window & { __whenReadyResult?: { ok?: boolean } }).__whenReadyResult,
      ),
    ).toEqual({ ok: true, value: undefined });
    const pixels = await page.evaluate(
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
        const sample = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
        const text = [8, 16, 24].flatMap((x) => [40, 48, 56].map((y) => sample(x, y)));
        return {
          width: bitmap.width,
          height: bitmap.height,
          image: [sample(8, 8), sample(24, 8)],
          textInk: text.some((pixel) => (pixel[0] ?? 255) < 200),
        };
      },
      [...output.png],
    );
    expect(pixels).toEqual({
      width: 64,
      height: 64,
      image: [
        [0, 136, 51, 255],
        [255, 119, 0, 255],
      ],
      textInk: true,
    });
  }, 60_000);

  it('publishes both failed assets when the error boundary throws', async () => {
    const renderer = await open('failing-assets');
    const owned = sessions.at(-1);
    if (owned === undefined) throw new Error('Session missing');
    await routeMissing(owned.page());
    const result = await renderer.renderFrame({ frame: 0 });
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) throw new Error('expected diagnostics');
    expect(result.error.map((diagnostic) => diagnostic.code)).toEqual([
      'asset.load-failed',
      'asset.load-failed',
    ]);
    expect(failedSources(result)).toEqual(['http://127.0.0.1:9/fail-a.png', '/fail-b.png']);
    expect(new Set(failedSources(result)).size).toBe(2);
  }, 60_000);

  it('publishes a loader rejection and a boundary failure as two entries', async () => {
    const renderer = await open('mixed-failure');
    const owned = sessions.at(-1);
    if (owned === undefined) throw new Error('Session missing');
    await routeMissing(owned.page());
    const result = await renderer.renderFrame({ frame: 0 });
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) throw new Error('expected diagnostics');
    expect(result.error.map((diagnostic) => diagnostic.code)).toEqual([
      'asset.load-failed',
      'asset.load-failed',
    ]);
    expect(failedSources(result)).toEqual([
      '/loader-rejected.png',
      '/boundary.png (+1 query parameter, redacted)',
    ]);
    expect(JSON.stringify(result)).not.toContain('token=');
    expect(JSON.stringify(result)).not.toContain('secret');
  }, 60_000);
});
