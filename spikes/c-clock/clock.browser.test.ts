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
  expect(report.results).toHaveLength(3);
  expect(report.negative).toHaveLength(4);
});
