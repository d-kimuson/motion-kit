import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { mountFixture, type Kind } from './fixture.tsx';

const kinds: Kind[] = ['font', 'image', 'gltf', 'texture'];
type Fixture = ReturnType<typeof mountFixture>;
const capture = async (fixture: Fixture) => ({
  dom: fixture.dom(),
  png: await page.screenshot({ element: fixture.host, save: false, animations: 'allow' }),
});
const pixelDifferences = async (first: string, second: string) => {
  const pixels = async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Missing 2D context');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 320, 180).data;
  };
  const a = await pixels(first);
  const b = await pixels(second);
  return a.reduce((count, value, index) => count + Number(value !== b[index]), 0);
};

test('image: onload-only and decode barriers agree for this SVG (not a decode stress test)', async () => {
  let fixture = mountFixture('image', 'immediate');
  try {
    expect(await fixture.seek(0)).toEqual({ ok: true });
    const decoded = await capture(fixture);
    const decodeEvents = [...fixture.events];
    await fixture.dispose();
    fixture = mountFixture('image', 'immediate', false, 'onload');
    expect(await fixture.seek(0)).toEqual({ ok: true });
    expect(await capture(fixture)).toEqual(decoded);
    expect(fixture.events).toEqual(['image.onload']);
    console.log(
      JSON.stringify({ onloadMatchesDecode: true, decodeEvents, onloadEvents: fixture.events }),
    );
  } finally {
    await fixture.dispose();
  }
});

test('font: document.fonts.ready resolves even when a required face failed', async () => {
  const fixture = mountFixture('font', 'fail');
  try {
    expect(await fixture.seek(0)).toMatchObject({ ok: false });
    await document.fonts.ready;
    expect(fixture.measure().fontStatus).toBe('error');
    console.log(JSON.stringify({ globalFontReadyDespiteFailure: true }));
  } finally {
    await fixture.dispose();
  }
});

test('texture: lost WebGL context is diagnosed before upload', async () => {
  const fixture = mountFixture('texture', 'delayed');
  try {
    await fixture.sourceReady;
    fixture.loseContext();
    await fixture.release();
    const failure = await fixture.seek(0);
    expect(failure).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'ASSET_LOAD_FAILED',
          asset: fixture.asset,
        },
      ],
    });
    const diagnostic = failure.ok ? undefined : failure.diagnostics[0];
    expect(diagnostic?.message).toContain('WebGL context lost before upload');
    console.log(JSON.stringify({ contextLoss: failure, environment: fixture.environment }));
  } finally {
    await fixture.dispose();
  }
});

for (const kind of kinds) {
  test(`${kind}: delayed negative control, ordered/fresh captures and Suspense`, async () => {
    let fixture = mountFixture(kind, 'delayed');
    const baseline = new Map<number, Awaited<ReturnType<typeof capture>>>();
    try {
      await fixture.sourceReady;
      const early = await capture(fixture);
      expect(fixture.pending()).toBe(true);
      expect(fixture.fallback()).toBe(false);
      // A timer is used ONLY to falsify readiness while the response is gated, never as a success barrier.
      const timeout = await fixture.seek(0, 300);
      expect(timeout).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'ASSET_TIMEOUT', asset: fixture.asset }],
      });
      const before = fixture.measure();
      await fixture.release();
      for (const frame of [0, 1, 2]) {
        expect(await fixture.seek(frame)).toEqual({ ok: true });
        baseline.set(frame, await capture(fixture));
      }
      const settled = baseline.get(0);
      if (settled === undefined) throw new Error('Missing baseline');
      const negativeBytes = await pixelDifferences(early.png, settled.png);
      expect(negativeBytes).toBeGreaterThan(0);
      expect(baseline.get(0)?.png).not.toEqual(baseline.get(2)?.png);
      const events = [...fixture.events];
      for (const frame of [2, 0, 1, 2]) {
        expect(await fixture.seek(frame)).toEqual({ ok: true });
        expect(await capture(fixture)).toEqual(baseline.get(frame));
      }
      await fixture.dispose();
      for (const frame of [0, 1, 2]) {
        fixture = mountFixture(kind, 'immediate');
        expect(await fixture.seek(frame)).toEqual({ ok: true });
        expect(await capture(fixture)).toEqual(baseline.get(frame));
        await fixture.dispose();
      }
      fixture = mountFixture(kind, 'delayed', true);
      expect(fixture.fallback()).toBe(true);
      const fallback = await capture(fixture);
      expect(await fixture.seek(0, 300)).toMatchObject({ ok: false });
      expect(fixture.fallback()).toBe(true);
      expect(fixture.measure().committed).toBe(-1);
      expect(await pixelDifferences(fallback.png, settled.png)).toBeGreaterThan(0);
      await fixture.release();
      expect(await fixture.seek(0)).toEqual({ ok: true });
      expect(fixture.fallback()).toBe(false);
      expect(await capture(fixture)).toEqual(settled);
      console.log(
        JSON.stringify({
          kind,
          negativeRGBABytes: negativeBytes,
          orderMatches: 4,
          freshMatches: 3,
          suspenseMatches: 1,
          fallbackCapturable: true,
          before,
          events,
        }),
      );
    } finally {
      if (fixture.host.isConnected) await fixture.dispose();
    }
  });

  test(`${kind}: named load failure and bounded never-settles diagnostic`, async () => {
    let fixture = mountFixture(kind, 'fail');
    try {
      const failure = await fixture.seek(0);
      expect(failure).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'ASSET_LOAD_FAILED', asset: fixture.asset }],
      });
      expect(fixture.pending()).toBe(true);
      console.log(JSON.stringify({ kind, failure, events: fixture.events }));
      await fixture.dispose();
      fixture = mountFixture(kind, 'stalled', true);
      const timeout = await fixture.seek(0, 100);
      expect(timeout).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'ASSET_TIMEOUT', asset: fixture.asset }],
      });
      expect(fixture.registry.pending()).toEqual([fixture.asset]);
      expect(fixture.fallback()).toBe(true);
      console.log(JSON.stringify({ kind, timeout }));
    } finally {
      await fixture.dispose();
    }
  });
}
