import { describe, expect, it } from 'vitest';

import { pngBytesMatch, requiredDeterminismModes } from './compare.ts';
import { defineDeterminismSuite, runDeterminismSuite } from './suite.ts';

const modulePath = new URL('./fixtures/references.tsx', import.meta.url).pathname;
const frames = [0, 1, 2, 3, 4, 5] as const;
const staticFiles = [
  {
    from: new URL('../../../spikes/d-assets/assets/Abel-Regular.ttf', import.meta.url).pathname,
    to: 'abel.ttf',
  },
  {
    from: new URL('../../../spikes/d-assets/assets/checker.svg', import.meta.url).pathname,
    to: 'checker.svg',
  },
];

const referenceSuite = (compositionId: string, sustainedPasses?: number) =>
  defineDeterminismSuite({
    composition: { name: compositionId, modulePath, compositionId, staticFiles },
    frames,
    ...(sustainedPasses === undefined ? {} : { sustainedPasses }),
  });

const logModes = (report: Awaited<ReturnType<typeof runDeterminismSuite>>): void => {
  for (const mode of report.compositions.flatMap((item) => item.modes)) console.info(mode.message);
};

describe('phase 1 determinism suite', () => {
  it('compares exact PNG bytes unless a cross-environment tolerance is explicit', () => {
    const left = Buffer.from([1, 2, 3, 4]);
    const right = Buffer.from([1, 2, 9, 4]);
    expect(pngBytesMatch(left, left)).toEqual({ equal: true, differentBytes: 0 });
    expect(pngBytesMatch(left, right).equal).toBe(false);
    expect(
      pngBytesMatch(left, right, { purpose: 'cross-environment', maxDifferentBytes: 1 }).equal,
    ).toBe(true);
    expect(
      pngBytesMatch(left, right, { purpose: 'cross-environment', maxDifferentBytes: 0 }).equal,
    ).toBe(false);
    expect(() =>
      defineDeterminismSuite({
        composition: { name: 'x', modulePath: 'x', compositionId: 'x' },
        frames: [0],
      }),
    ).toThrow(/at least two frames/);
  });

  it('captures DOM text identically across sequential, fresh, random, reverse, repeated and held modes', async () => {
    const report = await runDeterminismSuite(referenceSuite('dom-text'));
    logModes(report);
    expect(report.passed).toBe(true);
    expect(report.compositions[0]?.modes.map((mode) => mode.mode)).toEqual([
      ...requiredDeterminismModes,
    ]);
  }, 60_000);

  it.each(['css-transform', 'svg-path', 'sequence-boundary', 'transition-overlap'])(
    'captures %s identically across the eight traversal modes',
    async (compositionId) => {
      const report = await runDeterminismSuite(referenceSuite(compositionId));
      logModes(report);
      expect(report.passed).toBe(true);
      expect(report.compositions[0]?.framesDiffer).toBe(true);
    },
    60_000,
  );

  it('captures a canvas drawing identically, including repeated passes in one session', async () => {
    const report = await runDeterminismSuite(referenceSuite('canvas-drawing', 6));
    logModes(report);
    expect(report.passed).toBe(true);
    expect(report.compositions[0]?.modes.map((mode) => mode.mode)).toContain('sustained-session');
  }, 60_000);

  it('captures a nested Suspense font and image identically across the eight modes', async () => {
    const report = await runDeterminismSuite(referenceSuite('asset-suspense'));
    logModes(report);
    expect(report.passed).toBe(true);
    expect(report.compositions[0]?.framesDiffer).toBe(true);
    expect(report.compositions[0]?.modes.map((mode) => mode.mode)).toEqual([
      ...requiredDeterminismModes,
    ]);
  }, 60_000);

  it('fails a Math.random render and names the byte mismatch', async () => {
    const report = await runDeterminismSuite(referenceSuite('nondeterministic'));
    logModes(report);
    expect(report.passed).toBe(false);
    const mismatched = report.compositions
      .flatMap((item) => item.modes)
      .filter((mode) => !mode.equal)
      .map((mode) => mode.message);
    expect(mismatched.length).toBeGreaterThan(0);
    expect(mismatched.join('\n')).toMatch(
      /nondeterministic\/\S+: frame \d+ PNG bytes differ from the sequential 0\.\.N capture/,
    );
  }, 60_000);
});
