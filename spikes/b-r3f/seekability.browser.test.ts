import fc from 'fast-check';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { height, mountFixture, nextRaf, width, type Barrier } from './fixture.tsx';

const frames = [0, 1, 7, 15, 29, 30, 31, 45, 59, 60];
const seed = 144;
const shuffled =
  fc.sample(fc.shuffledSubarray(frames, { minLength: frames.length, maxLength: frames.length }), {
    seed,
    numRuns: 1,
  })[0] ?? [];
const randomFrames = [...shuffled, 60, 0, 15, 60];
type Fixture = Awaited<ReturnType<typeof mountFixture>>;
const capture = async (fixture: Fixture) => ({
  dom: fixture.dom(),
  png: await page.screenshot({ element: fixture.canvas, save: false, animations: 'allow' }),
});

// Compare screenshot pixels to the actual WebGL framebuffer, not just another screenshot.
const screenshotPixels = async (png: string) => {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Missing 2D context');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
};
const readbackMismatchCount = async (png: string, bottomUp: Uint8Array) => {
  const topDown = await screenshotPixels(png);
  let mismatches = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) {
      if (topDown[y * width * 4 + x] !== bottomUp[(height - 1 - y) * width * 4 + x]) mismatches++;
    }
  }
  return mismatches;
};

test('absolute time: sequential, seeded random, fresh roots and held frames agree', async () => {
  expect(shuffled).toHaveLength(frames.length);
  const baseline = new Map<number, Awaited<ReturnType<typeof capture>>>();
  let fixture = await mountFixture();
  try {
    console.log(JSON.stringify({ environment: fixture.environment }));
    for (let frame = 0; frame <= 60; frame++) {
      await fixture.seek(frame / 30);
      expect(fixture.inspect().elapsed).toBe(frame / 30);
      if (frames.includes(frame)) baseline.set(frame, await capture(fixture));
    }
    expect(fixture.stats()).toMatchObject({
      calls: 61,
      triangles: 61440,
      drawCalls: 64,
      frameloop: 'never',
      clockRunning: false,
    });
    expect(fixture.inspect().uniform).toBe(2);
    expect(baseline.get(0)?.png).not.toEqual(baseline.get(15)?.png);
    expect(baseline.get(15)?.png).not.toEqual(baseline.get(60)?.png);
    const end = baseline.get(60);
    if (end === undefined) throw new Error('Missing end frame');
    expect(await readbackMismatchCount(end.png, fixture.pixels())).toBe(0);
    fixture.dispose();
    fixture = await mountFixture();
    for (const frame of randomFrames) {
      await fixture.seek(frame / 30);
      expect(await capture(fixture)).toEqual(baseline.get(frame));
    }
    await fixture.seek(0.5);
    const callsBeforeHold = fixture.stats().calls;
    for (let tick = 0; tick < 3; tick++) await nextRaf();
    expect(fixture.stats().calls).toBe(callsBeforeHold);
    expect(await capture(fixture)).toEqual(baseline.get(15));
    fixture.dispose();
    for (const frame of frames) {
      fixture = await mountFixture();
      await fixture.seek(frame / 30);
      expect(await capture(fixture)).toEqual(baseline.get(frame));
      fixture.dispose();
    }
    console.log(
      JSON.stringify({
        seed,
        randomFrames,
        sequentialAdvances: 61,
        randomMatches: 14,
        freshMatches: 10,
        heldMatches: 1,
        captures: 35,
        readbackByteMismatches: 0,
      }),
    );
  } finally {
    if (fixture.host.isConnected) fixture.dispose();
  }
});

test('GPU barriers: finish, readback, rAF and no explicit fence match the reference', async () => {
  let fixture = await mountFixture();
  const times = [0, 0.5, 2, 0.1, 1, 0, 2];
  const baseline = new Map<number, string>();
  try {
    for (const time of times) {
      await fixture.seek(time, 'finish');
      const pixels = fixture.pixels();
      const { png } = await capture(fixture);
      expect(await readbackMismatchCount(png, pixels)).toBe(0);
      baseline.set(time, png);
    }
    fixture.dispose();
    for (const barrier of ['finish', 'readback', 'raf', 'none'] satisfies Barrier[]) {
      fixture = await mountFixture();
      for (const time of times) {
        await fixture.seek(time, barrier);
        // No hidden readPixels/toDataURL before these captures: that would mask a missing fence.
        expect((await capture(fixture)).png).toEqual(baseline.get(time));
      }
      console.log(JSON.stringify({ barrier, matches: times.length, captures: times.length }));
      fixture.dispose();
    }
  } finally {
    if (fixture.host.isConnected) fixture.dispose();
  }
});

for (const fault of [
  'integrated-rotation',
  'integrated-uniform',
  'sticky-camera',
  'skip-advance',
] as const) {
  test(`${fault}: negative control detects history versus a fresh root`, async () => {
    let fixture = await mountFixture(fault);
    try {
      await fixture.seek(0.5);
      const expected = await capture(fixture);
      fixture.dispose();
      fixture = await mountFixture(fault);
      for (const time of [0, 2, 0.5]) await fixture.seek(time);
      const actual = await capture(fixture);
      expect(actual.dom).not.toEqual(expected.dom);
      expect(actual.png).not.toEqual(expected.png);
      console.log(
        JSON.stringify({ fault, domMismatch: true, pngMismatch: true, state: fixture.inspect() }),
      );
    } finally {
      fixture.dispose();
    }
  });
}

test('advance delta is signed history, not a pure frame input', async () => {
  const fixture = await mountFixture();
  try {
    const deltas: number[] = [];
    for (const time of [0, 2, 0.5, 0.5]) {
      await fixture.seek(time);
      deltas.push(fixture.stats().lastDelta);
    }
    expect(deltas).toEqual([0, 2, -1.5, 0]);
    console.log(JSON.stringify({ advanceTimesSeconds: [0, 2, 0.5, 0.5], deltas }));
  } finally {
    fixture.dispose();
  }
});

test('non-preserved drawing buffer: delayed capture is measured, not assumed safe', async () => {
  let fixture = await mountFixture();
  try {
    await fixture.seek(0.5);
    const reference = (await capture(fixture)).png;
    fixture.dispose();
    fixture = await mountFixture('none', false);
    await fixture.seek(0.5);
    const immediate = (await capture(fixture)).png;
    for (let tick = 0; tick < 3; tick++) await nextRaf();
    const delayed = (await capture(fixture)).png;
    // This is a portability observation, not a claim that preserveDrawingBuffer=false must fail.
    expect(fixture.environment.attributes?.preserveDrawingBuffer).toBe(false);
    console.log(
      JSON.stringify({
        preserveDrawingBuffer: false,
        immediateScreenshotMatches: immediate === reference,
        delayedScreenshotMatches: delayed === reference,
        delayedReadbackByteMismatches: await readbackMismatchCount(delayed, fixture.pixels()),
      }),
    );
  } finally {
    fixture.dispose();
  }
});
