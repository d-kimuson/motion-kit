import { describe, expect, it } from 'vitest';

import { defineDeterminismSuite, runDeterminismSuite } from '../render/determinism/suite.ts';

const modulePath = new URL('./fixtures/reference.tsx', import.meta.url).pathname;

/** The candidate needs a software renderer: CI has no GPU, and the run must be reproducible. */
const suite = (compositionId: string, frames: readonly number[]) =>
  defineDeterminismSuite({
    composition: { name: compositionId, modulePath, compositionId, softwareWebGL: true },
    frames,
  });

const logModes = (report: Awaited<ReturnType<typeof runDeterminismSuite>>): void => {
  for (const mode of report.compositions.flatMap((item) => item.modes)) console.info(mode.message);
};

describe('three canvas determinism', () => {
  it('captures a ThreeCanvas and CameraRig identically across the traversal modes', async () => {
    const report = await runDeterminismSuite(suite('three-canvas', [0, 2, 5]));
    logModes(report);
    expect(report.passed).toBe(true);
    expect(report.compositions[0]?.framesDiffer).toBe(true);
  }, 180_000);

  it('refuses to certify a canvas with a useFrame subscriber', async () => {
    const report = await runDeterminismSuite(suite('three-canvas-uncontrolled', [0, 2]));
    logModes(report);
    expect(report.passed).toBe(false);
    expect(
      report.compositions
        .flatMap((item) => item.modes)
        .map((mode) => mode.message)
        .join('\n'),
    ).toMatch(/seek\.uncontrolled/);
  }, 120_000);
});
