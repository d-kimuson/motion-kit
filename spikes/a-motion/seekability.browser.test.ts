import fc from 'fast-check';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { afterMotionRender, controlledFeatures, mountFixture } from './fixture.tsx';

const chosenFrames = [0, 1, 7, 15, 29, 30, 31, 45, 59, 60];
const seed = 143;
const shuffled =
  fc.sample(
    fc.shuffledSubarray(chosenFrames, {
      minLength: chosenFrames.length,
      maxLength: chosenFrames.length,
    }),
    { seed, numRuns: 1 },
  )[0] ?? [];
const randomFrames = [...shuffled, 60, 0, 15, 60];

const capture = async (host: HTMLElement) => {
  // Fixed-size, non-animated crop. Never disable/fast-forward animations for comparison.
  const png = await page.screenshot({ element: host, save: false, animations: 'allow' });
  return png;
};

for (const feature of controlledFeatures) {
  test(`${feature}: sequential, random and isolated frames agree`, async () => {
    expect(shuffled).toHaveLength(chosenFrames.length);
    const baseline = new Map<
      number,
      { dom: ReturnType<Awaited<ReturnType<typeof mountFixture>>['inspect']>; png: string }
    >();
    let fixture = await mountFixture(feature);
    let staleImmediateReads = 0;
    try {
      for (let frame = 0; frame <= 60; frame++) {
        const result = await fixture.seek(frame / 30);
        if (JSON.stringify(result.immediate) !== JSON.stringify(result.settled))
          staleImmediateReads++;
        if (chosenFrames.includes(frame))
          baseline.set(frame, { dom: result.settled, png: await capture(fixture.host) });
      }
      // Non-vacuity: matching constant/blank frames must not pass.
      expect(baseline.get(0)?.png).not.toEqual(baseline.get(15)?.png);
      expect(baseline.get(0)?.dom[0]?.left).toBe(0);
      expect(baseline.get(60)?.dom[0]?.left).toBe(feature === 'animate-dom' ? 0 : 160);
      expect(baseline.get(0)?.dom[0]?.opacity).toBe(feature === 'animate-dom' ? '0' : '1');
      expect(baseline.get(60)?.dom[0]?.opacity).toBe('1');
      fixture.dispose();
      fixture = await mountFixture(feature);
      let randomMatches = 0;
      for (const frame of randomFrames) {
        const result = await fixture.seek(frame / 30);
        const expected = baseline.get(frame);
        expect(result.settled).toEqual(expected?.dom);
        expect(await capture(fixture.host)).toEqual(expected?.png);
        randomMatches++;
      }
      await fixture.seek(0.5);
      for (let tick = 0; tick < 3; tick++) await afterMotionRender();
      const nativeAnimations = fixture.host.getAnimations({ subtree: true }).map((animation) => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
      }));
      expect(nativeAnimations).toEqual(
        feature === 'animate-dom' ? [{ playState: 'paused', currentTime: 500 }] : [],
      );
      expect(fixture.inspect()).toEqual(baseline.get(15)?.dom);
      expect(await capture(fixture.host)).toEqual(baseline.get(15)?.png);
      fixture.dispose();
      let isolatedMatches = 0;
      for (const frame of chosenFrames) {
        fixture = await mountFixture(feature);
        const result = await fixture.seek(frame / 30);
        expect(result.settled).toEqual(baseline.get(frame)?.dom);
        expect(await capture(fixture.host)).toEqual(baseline.get(frame)?.png);
        isolatedMatches++;
        fixture.dispose();
      }
      console.log(
        JSON.stringify({
          feature,
          seed,
          randomFrames,
          sequentialFrames: 61,
          nativeAnimations,
          captures: 35,
          start: baseline.get(0)?.dom,
          midpoint: baseline.get(15)?.dom,
          end: baseline.get(60)?.dom,
          randomMatches,
          isolatedMatches,
          staleImmediateReads,
        }),
      );
    } finally {
      // The isolated loop disposes each root; only clean up a still-mounted fixture.
      if (fixture.host.isConnected) fixture.dispose();
    }
  });
}

for (const feature of ['presence', 'layout', 'use-spring', 'autonomous'] as const) {
  test(`${feature}: frame time alone does not erase history`, async () => {
    let fixture = await mountFixture(feature);
    try {
      for (let frame = 0; frame <= 30; frame++) await fixture.seek(frame / 30);
      // Projection and React presence can schedule additional work. This is deliberately
      // NOT a completion claim for uncontrolled animations.
      await afterMotionRender();
      const history = fixture.inspect();
      const historyPng = await capture(fixture.host);
      fixture.dispose();
      fixture = await mountFixture(feature, 1);
      await fixture.seek(1);
      await afterMotionRender();
      const isolated = fixture.inspect();
      const isolatedPng = await capture(fixture.host);
      expect(history).not.toEqual(isolated);
      expect(historyPng).not.toEqual(isolatedPng);
      console.log(JSON.stringify({ feature, history, isolated, pixelMismatch: true }));
    } finally {
      fixture.dispose();
    }
  });
}
