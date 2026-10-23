import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';

import type { ComparisonReport } from './experiment.ts';

declare module 'vitest/browser' {
  // eslint-disable-next-line typescript/consistent-type-definitions -- Vitest custom command augmentation.
  interface BrowserCommands {
    compareClocks: () => Promise<ComparisonReport>;
  }
}

test('compare three clock strategies, frame orders and missing-adapter controls', async () => {
  const report = await commands.compareClocks();
  expect(report.repetitions).toHaveLength(3);
  for (const repetition of report.repetitions) {
    expect(repetition.results).toHaveLength(3);
    expect(repetition.negative).toHaveLength(4);
  }
  expect(report.costRanges.map((range) => range.mechanism)).toEqual(['own', 'raf', 'cdp']);
  for (const range of report.costRanges) {
    const means = report.repetitions.map(
      (repetition) =>
        repetition.results.find((result) => result.mechanism === range.mechanism)?.cost.meanMs,
    );
    expect(range.repetitions).toBe(3);
    expect(range.meansMs).toEqual(means);
    expect(range.minMeanMs).toBe(Math.min(...range.meansMs));
    expect(range.maxMeanMs).toBe(Math.max(...range.meansMs));
  }
});
